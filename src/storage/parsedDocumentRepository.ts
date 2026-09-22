import * as FileSystem from 'expo-file-system/legacy';

import { ChapterInfo, ParsedDocument, PdfPageInfo, TextBlock, TocEntry } from '../types/document';
import { makeTextBlock } from '../utils/textBlocks';
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

// Versión de lo que se guarda en el caché. Subirla descarta TODO el caché en el
// próximo arranque (los libros se re-procesan solos al abrirse; el progreso y las
// anotaciones no se tocan).
//   2 — los bloques pasaron a tener offsets exactos sobre el texto original. Los
//       cacheados con la versión anterior apuntaban a lugares corridos del texto.
//   3 — se guarda también el índice del EPUB.
//   4 — texto de PDF extraído con Pdfium (otro orden y otros cortes que PDFBox) y
//       bloques guardados solo como offsets.
//   5 — los capítulos resueltos se guardan con el documento: abrir un libro
//       cacheado ya no vuelve a detectarlos sobre todo el texto.
const PARSED_CACHE_VERSION = 5;
const PARSED_CACHE_VERSION_KEY = 'runtime.parsedCacheVersion';

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

type DocumentInfo = { pdf?: PdfPageInfo; toc?: TocEntry[]; chapters?: ChapterInfo[] };

function isChapterInfo(value: unknown): value is ChapterInfo {
  if (!value || typeof value !== 'object') return false;
  const chapter = value as Record<string, unknown>;
  return (
    typeof chapter.id === 'string' &&
    typeof chapter.title === 'string' &&
    typeof chapter.startChar === 'number' &&
    typeof chapter.endChar === 'number' &&
    typeof chapter.orderIndex === 'number'
  );
}

/** Info extra del documento (mapa de páginas del PDF, índice del EPUB). */
function parseDocumentInfoJson(value: string | null | undefined): DocumentInfo {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { pdf?: unknown; toc?: unknown; chapters?: unknown } | null;
    if (!parsed) return {};
    const chapters = Array.isArray(parsed.chapters) ? parsed.chapters.filter(isChapterInfo) : undefined;
    const toc = Array.isArray(parsed.toc)
      ? (parsed.toc as TocEntry[]).filter(
          (entry) => entry && typeof entry.title === 'string' && typeof entry.startChar === 'number' && typeof entry.level === 'number',
        )
      : undefined;
    return { pdf: parsePdfInfo(parsed.pdf), toc: toc && toc.length > 0 ? toc : undefined, chapters };
  } catch {
    return {};
  }
}

function buildDocumentInfoJson(document: ParsedDocument): string | null {
  return JSON.stringify({ pdf: document.pdf, toc: document.toc, chapters: document.chapters ?? [] });
}

function parsePdfInfo(value: unknown): PdfPageInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const parsed = value as Partial<PdfPageInfo>;
    if (!parsed || typeof parsed.pageCount !== 'number' || !Array.isArray(parsed.pageOffsets)) return undefined;
    const crop = Array.isArray(parsed.crop) && parsed.crop.length === 4 ? parsed.crop : null;
    return {
      ...(parsed.kind === 'comic' ? { kind: 'comic' as const } : {}),
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

/**
 * Los bloques se guardan SOLO como offsets ([inicio, fin, inicio, fin, …]): su texto
 * es fullText.slice(inicio, fin). Guardar también el texto duplicaba el libro en
 * disco y, sobre todo, obligaba a parsear varios MB de JSON en cada apertura.
 */
function serializeBlocks(document: ParsedDocument): string {
  const { blocks, fullText } = document;
  const offsets: number[] = [];
  for (const block of blocks) {
    if (fullText.slice(block.startChar, block.endChar) !== block.text) {
      return JSON.stringify(blocks); // no debería pasar; ante la duda, formato completo
    }
    offsets.push(block.startChar, block.endChar);
  }
  // `n` = largo del texto con el que se midieron estos offsets. Si al leer no
  // coincide, la pareja archivo-texto no es la misma (un corte entre las dos
  // escrituras) y el caché se descarta en vez de abrir el libro corrido.
  return JSON.stringify({ v: 2, n: fullText.length, o: offsets });
}

function parseBlocksJson(value: string, fullText: string): TextBlock[] {
  try {
    const parsed = JSON.parse(value);

    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.o)) {
      // Pareja rota (bloques nuevos con texto viejo, o al revés): re-parsear.
      if (typeof parsed.n === 'number' && parsed.n !== fullText.length) return [];
      const offsets = parsed.o as unknown[];
      const blocks: TextBlock[] = [];
      for (let i = 0; i + 1 < offsets.length; i += 2) {
        const startChar = offsets[i];
        const endChar = offsets[i + 1];
        if (typeof startChar !== 'number' || typeof endChar !== 'number' || endChar > fullText.length) return [];
        blocks.push(makeTextBlock(fullText, blocks.length, startChar, endChar));
      }
      return blocks;
    }

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

  const blocks = parseBlocksJson(blocksRaw, fullText);

  if (!fullText.trim() || blocks.length === 0) {
    return null;
  }

  const info = parseDocumentInfoJson(pdfInfoRaw);
  return {
    id: document.id,
    fileName: document.name,
    sourceUri: document.uri,
    fullText,
    blocks,
    chapters: info.chapters ?? [],
    pdf: info.pdf,
    toc: info.toc,
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
  /**
   * Tamaño del libro para estimar cuánto falta: largo del texto y total de
   * páginas. Usa `length()` de SQLite, así que NO trae el texto por el puente
   * (el de un tomo largo son varios MB y esto se pide desde la biblioteca).
   * null en lo que no se sepa; nunca se inventa un número.
   */
  /**
   * Solo el mapa de páginas del caché, SIN el texto ni los bloques.
   *
   * Para dibujar la página 1 de un PDF alcanza con esto. Traer el documento
   * entero son varios MB por el puente, un JSON.parse grande y materializar
   * miles de bloques: en un tomo largo eso es todo tiempo antes del primer
   * píxel, justo lo que la apertura instantánea quiere evitar. El documento
   * completo se carga después, de fondo.
   */
  async getCachedPdfInfo(bookId: string): Promise<PdfPageInfo | undefined> {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<{ pdfInfoJson: string | null }>(
        'SELECT pdfInfoJson FROM parsed_document_cache WHERE bookId = ?',
        [bookId],
      );
      if (row) return parseDocumentInfoJson(row.pdfInfoJson).pdf;
      const dir = getCacheDirectory();
      if (!dir) return undefined;
      const raw = await FileSystem.readAsStringAsync(pdfInfoPath(dir, bookId)).catch(() => null);
      return parseDocumentInfoJson(raw).pdf;
    } catch {
      return undefined;
    }
  },

  async getReadingSize(bookId: string): Promise<{ textLength: number | null; pageCount: number | null }> {
    const vacio = { textLength: null, pageCount: null };
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<{ textLength: number | null; pdfInfoJson: string | null }>(
        `SELECT length(fullText) AS textLength, pdfInfoJson
         FROM parsed_document_cache WHERE bookId = ?`,
        [bookId],
      );
      if (row) {
        return {
          textLength: row.textLength ?? null,
          pageCount: parseDocumentInfoJson(row.pdfInfoJson).pdf?.pageCount ?? null,
        };
      }
      // Libros grandes: el caché vive en disco.
      const dir = getCacheDirectory();
      if (!dir) return vacio;
      const [info, pdfInfoRaw] = await Promise.all([
        FileSystem.getInfoAsync(fullTextPath(dir, bookId)),
        FileSystem.readAsStringAsync(pdfInfoPath(dir, bookId)).catch(() => null),
      ]);
      return {
        // El tamaño del archivo son BYTES: en castellano queda un pelo por
        // encima del número de caracteres, y la estimación ya lleva un "~".
        textLength: info.exists && info.size ? info.size : null,
        pageCount: parseDocumentInfoJson(pdfInfoRaw).pdf?.pageCount ?? null,
      };
    } catch {
      return vacio;
    }
  },

  async getParsedDocument(document: DocumentRef): Promise<ParsedDocument | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ParsedDocumentRow>(
      `SELECT bookId, fullText, blocksJson, chaptersJson, pdfInfoJson, savedAt
       FROM parsed_document_cache WHERE bookId = ?`,
      [document.id],
    );

    if (row) {
      const blocks = parseBlocksJson(row.blocksJson, row.fullText);
      if (row.fullText.trim() && blocks.length > 0) {
        const info = parseDocumentInfoJson(row.pdfInfoJson);
        return {
          id: document.id,
          fileName: document.name,
          sourceUri: document.uri,
          fullText: row.fullText,
          blocks,
          chapters: info.chapters ?? [],
          pdf: info.pdf,
          toc: info.toc,
        };
      }
    }

    // Libros grandes: caché en disco.
    return readDiskCache(document);
  },

  async saveParsedDocument(document: DocumentRef, parsedDocument: ParsedDocument) {
    // Un documento provisorio (texto todavía en preparación) no es el libro.
    if (parsedDocument.pdf?.textPending) return;
    const blocksJson = serializeBlocks(parsedDocument);
    const pdfInfoJson = buildDocumentInfoJson(parsedDocument);
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

  /** Descarta el caché si lo escribió una versión anterior del procesamiento. */
  async ensureCacheVersion() {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      PARSED_CACHE_VERSION_KEY,
    ]);
    if (row?.value === String(PARSED_CACHE_VERSION)) return;

    await this.clearAllParsedDocuments();
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [PARSED_CACHE_VERSION_KEY, String(PARSED_CACHE_VERSION)],
    );
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
