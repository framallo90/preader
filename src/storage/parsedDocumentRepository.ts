import * as FileSystem from 'expo-file-system/legacy';

import { ParsedDocument, PdfPageInfo, TextBlock } from '../types/document';
import { getDatabase } from './database';

// Acepta tanto Book como StoredDocument (ambos tienen id, name, uri)
export type DocumentRef = { id: string; name: string; uri: string };

type ParsedDocumentRow = {
  bookId: string;
  fullText: string;
  blocksJson: string;
  chaptersJson: string;
  pdfInfoJson: string | null;
  savedAt: string;
};

// Los libros chicos se cachean inline en SQLite (rápido y transaccional). Los
// grandes se guardan como archivos en disco: meter varios MB de texto + JSON en
// una fila SQLite es frágil, así que antes directamente NO se cacheaban y por eso
// una saga se re-extraía entera en cada apertura. Con el caché en disco, la 1ª
// apertura extrae una vez y las siguientes son instantáneas.
const MAX_CACHEABLE_TEXT_LENGTH = 500_000;
const MAX_CACHEABLE_BLOCKS = 4_000;
const MAX_CACHEABLE_BLOCKS_JSON_LENGTH = 900_000;

function getCacheDirectory(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}parsed-cache` : null;
}

function fullTextPath(dir: string, bookId: string): string {
  return `${dir}/${encodeURIComponent(bookId)}.fulltext.txt`;
}

function blocksPath(dir: string, bookId: string): string {
  return `${dir}/${encodeURIComponent(bookId)}.blocks.json`;
}

function pdfInfoPath(dir: string, bookId: string): string {
  return `${dir}/${encodeURIComponent(bookId)}.pdfinfo.json`;
}

function parsePdfInfoJson(value: string | null | undefined): PdfPageInfo | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PdfPageInfo> | null;
    if (!parsed || typeof parsed.pageCount !== 'number' || !Array.isArray(parsed.pageOffsets)) return undefined;
    const crop = Array.isArray(parsed.crop) && parsed.crop.length === 4 ? parsed.crop : null;
    return {
      pageCount: parsed.pageCount,
      pageAspect: typeof parsed.pageAspect === 'number' ? parsed.pageAspect : null,
      pageOffsets: parsed.pageOffsets.filter((n): n is number => typeof n === 'number'),
      crop: crop as PdfPageInfo['crop'],
      outline: Array.isArray(parsed.outline)
        ? parsed.outline.filter(
            (entry) =>
              entry && typeof entry.title === 'string' && typeof entry.pageIndex === 'number' && typeof entry.level === 'number',
          )
        : [],
      hasText: parsed.hasText !== false,
    };
  } catch {
    return undefined;
  }
}

async function ensureCacheDirectory(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

function isTextBlock(value: unknown): value is TextBlock {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const block = value as Record<string, unknown>;

  return (
    typeof block.index === 'number' &&
    typeof block.text === 'string' &&
    typeof block.startChar === 'number' &&
    typeof block.endChar === 'number'
  );
}

function parseBlocksJson(value: string): TextBlock[] {
  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isTextBlock);
  } catch {
    return [];
  }
}

async function readDiskCache(document: DocumentRef): Promise<ParsedDocument | null> {
  const dir = getCacheDirectory();
  if (!dir) return null;

  const ftPath = fullTextPath(dir, document.id);
  const blPath = blocksPath(dir, document.id);

  const [ftInfo, blInfo] = await Promise.all([
    FileSystem.getInfoAsync(ftPath),
    FileSystem.getInfoAsync(blPath),
  ]);

  if (!ftInfo.exists || !blInfo.exists) {
    return null;
  }

  const [fullText, blocksRaw, pdfInfoRaw] = await Promise.all([
    FileSystem.readAsStringAsync(ftPath),
    FileSystem.readAsStringAsync(blPath),
    FileSystem.readAsStringAsync(pdfInfoPath(dir, document.id)).catch(() => null),
  ]);

  const blocks = parseBlocksJson(blocksRaw);

  if (!fullText.trim() || blocks.length === 0) {
    return null;
  }

  // chapters se re-detectan en reader.tsx con el bookId correcto.
  return {
    id: document.id,
    fileName: document.name,
    sourceUri: document.uri,
    fullText,
    blocks,
    chapters: [],
    pdf: parsePdfInfoJson(pdfInfoRaw),
  };
}

// Cuántos libros grandes mantener en el caché en disco. Al superarlo, se
// evictan los más viejos (por mtime) para que el directorio no crezca sin fin.
const MAX_DISK_CACHE_BOOKS = 12;

async function writeDiskCache(
  bookId: string,
  fullText: string,
  blocksJson: string,
  pdfInfoJson: string | null,
): Promise<void> {
  const dir = getCacheDirectory();
  if (!dir) return;

  await ensureCacheDirectory(dir);
  if (pdfInfoJson) {
    await FileSystem.writeAsStringAsync(pdfInfoPath(dir, bookId), pdfInfoJson);
  } else {
    await FileSystem.deleteAsync(pdfInfoPath(dir, bookId), { idempotent: true }).catch(() => {});
  }
  // Escribe los bloques primero: readDiskCache exige ambos archivos, así que un
  // corte entre escrituras solo produce un miss (re-parseo), nunca corrupción.
  await FileSystem.writeAsStringAsync(blocksPath(dir, bookId), blocksJson);
  await FileSystem.writeAsStringAsync(fullTextPath(dir, bookId), fullText);
  await evictDiskCache(dir).catch(() => {});
}

/** Mantiene solo los MAX_DISK_CACHE_BOOKS libros más recientes en disco. */
async function evictDiskCache(dir: string): Promise<void> {
  const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  const fullTextFiles = files.filter((f) => f.endsWith('.fulltext.txt'));
  if (fullTextFiles.length <= MAX_DISK_CACHE_BOOKS) return;

  const withTime = await Promise.all(
    fullTextFiles.map(async (f) => {
      const info = await FileSystem.getInfoAsync(`${dir}/${f}`);
      return { name: f, mtime: info.exists ? info.modificationTime ?? 0 : 0 };
    }),
  );
  withTime.sort((a, b) => a.mtime - b.mtime); // más viejo primero
  const toEvict = withTime.slice(0, withTime.length - MAX_DISK_CACHE_BOOKS);
  for (const { name } of toEvict) {
    const base = name.slice(0, -'.fulltext.txt'.length);
    await FileSystem.deleteAsync(`${dir}/${name}`, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(`${dir}/${base}.blocks.json`, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(`${dir}/${base}.pdfinfo.json`, { idempotent: true }).catch(() => {});
  }
}

async function deleteDiskCache(bookId: string): Promise<void> {
  const dir = getCacheDirectory();
  if (!dir) return;

  await Promise.all([
    FileSystem.deleteAsync(fullTextPath(dir, bookId), { idempotent: true }).catch(() => {}),
    FileSystem.deleteAsync(blocksPath(dir, bookId), { idempotent: true }).catch(() => {}),
    FileSystem.deleteAsync(pdfInfoPath(dir, bookId), { idempotent: true }).catch(() => {}),
  ]);
}

export const parsedDocumentRepository = {
  async getParsedDocument(document: DocumentRef): Promise<ParsedDocument | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ParsedDocumentRow>(
      `SELECT bookId, fullText, blocksJson, chaptersJson, pdfInfoJson, savedAt
       FROM parsed_document_cache WHERE bookId = ?`,
      [document.id],
    );

    if (row) {
      const blocks = parseBlocksJson(row.blocksJson);
      if (row.fullText.trim() && blocks.length > 0) {
        // chapters se re-detectan en reader.tsx con el bookId correcto;
        // los devolvemos vacíos para que el caller siempre llame a detectChapters.
        return {
          id: document.id,
          fileName: document.name,
          sourceUri: document.uri,
          fullText: row.fullText,
          blocks,
          chapters: [],
          pdf: parsePdfInfoJson(row.pdfInfoJson),
        };
      }
    }

    // Libros grandes: caché en disco.
    return readDiskCache(document);
  },

  async saveParsedDocument(document: DocumentRef, parsedDocument: ParsedDocument) {
    const blocksJson = JSON.stringify(parsedDocument.blocks);
    const pdfInfoJson = parsedDocument.pdf ? JSON.stringify(parsedDocument.pdf) : null;
    const fitsSqlite =
      parsedDocument.fullText.length <= MAX_CACHEABLE_TEXT_LENGTH &&
      parsedDocument.blocks.length <= MAX_CACHEABLE_BLOCKS &&
      blocksJson.length <= MAX_CACHEABLE_BLOCKS_JSON_LENGTH;

    if (fitsSqlite) {
      // Un posible caché en disco previo (versión más grande) quedaría huérfano.
      await deleteDiskCache(document.id);

      const chaptersJson = JSON.stringify(parsedDocument.chapters ?? []);
      const db = await getDatabase();

      await db.runAsync(
        `INSERT INTO parsed_document_cache (bookId, fullText, blocksJson, chaptersJson, pdfInfoJson, savedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(bookId) DO UPDATE SET
           fullText = excluded.fullText,
           blocksJson = excluded.blocksJson,
           chaptersJson = excluded.chaptersJson,
           pdfInfoJson = excluded.pdfInfoJson,
           savedAt = excluded.savedAt`,
        [document.id, parsedDocument.fullText, blocksJson, chaptersJson, pdfInfoJson, new Date().toISOString()],
      );
      return;
    }

    // Libro grande: se persiste en disco para que la reapertura sea instantánea.
    // Si la escritura falla, se deja sin cachear (se re-parsea la próxima vez):
    // nunca debe romper la apertura del documento.
    try {
      await writeDiskCache(document.id, parsedDocument.fullText, blocksJson, pdfInfoJson);
      // Limpia una fila SQLite previa (p. ej. si antes entraba en el tope inline).
      const db = await getDatabase();
      await db.runAsync('DELETE FROM parsed_document_cache WHERE bookId = ?', [document.id]);
    } catch {
      await deleteDiskCache(document.id);
    }
  },

  async removeParsedDocument(documentId: string) {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM parsed_document_cache WHERE bookId = ?', [documentId]);
    await deleteDiskCache(documentId);
  },

  /**
   * Borra TODO el caché de texto procesado (SQLite + archivos). No toca libros
   * ni progreso: al reabrir, cada libro se re-procesa en el teléfono.
   */
  async clearAllParsedDocuments() {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM parsed_document_cache');
    const dir = getCacheDirectory();
    if (!dir) return;
    try {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch {
      // best-effort
    }
  },
};
