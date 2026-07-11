/**
 * libraryScanService.ts — biblioteca por descubrimiento (modelo ReadEra).
 *
 * El usuario autoriza carpetas via Storage Access Framework; en cada
 * escaneo se detectan archivos soportados nuevos y se agregan solos a la
 * biblioteca, sin copiarlos (se referencian in-place por content://).
 * Los PDF se materializan a copia local recién al abrirlos, porque el
 * extractor nativo necesita un file:// real.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase } from '../storage/database';
import { bookRepository } from '../storage/bookRepository';
import { Book } from '../types/storage';
import { createBookFingerprint } from '../utils/documentId';

const { StorageAccessFramework } = FileSystem;

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const IGNORED_BOOKS_KEY = 'library.ignoredBookIds';

/**
 * Libros que el usuario eliminó de la biblioteca pero cuyo archivo sigue
 * en una carpeta escaneada: se recuerdan para no re-agregarlos solos.
 */
async function getIgnoredBookIds(): Promise<Set<string>> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [IGNORED_BOOKS_KEY],
  );
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

async function saveIgnoredBookIds(ids: Set<string>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [IGNORED_BOOKS_KEY, JSON.stringify([...ids])],
  );
}

export async function addIgnoredBook(bookId: string): Promise<void> {
  const ids = await getIgnoredBookIds();
  ids.add(bookId);
  await saveIgnoredBookIds(ids);
}

export async function clearIgnoredBook(bookId: string): Promise<void> {
  const ids = await getIgnoredBookIds();
  if (ids.delete(bookId)) {
    await saveIgnoredBookIds(ids);
  }
}

/**
 * Vacía la lista de ignorados: los libros borrados que sigan en carpetas
 * escaneadas vuelven a aparecer en el próximo escaneo. Devuelve cuántos había.
 */
export async function getIgnoredBooksCount(): Promise<number> {
  return (await getIgnoredBookIds()).size;
}

export async function restoreIgnoredBooks(): Promise<number> {
  const ids = await getIgnoredBookIds();
  const count = ids.size;
  if (count > 0) await saveIgnoredBookIds(new Set());
  return count;
}

/** Pide al usuario que elija una carpeta. Devuelve su URI SAF o null. */
export async function requestLibraryFolder(): Promise<string | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  return permission.granted ? permission.directoryUri : null;
}

/** Nombre legible de un URI SAF (última porción decodificada). */
export function getDisplayNameFromSafUri(uri: string): string {
  const lastSegment = uri.split('/').pop() ?? uri;
  try {
    const decoded = decodeURIComponent(lastSegment);
    return decoded.split(':').pop() ?? decoded;
  } catch {
    return lastSegment;
  }
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Escanea las carpetas autorizadas y agrega a la biblioteca los archivos
 * soportados que todavía no estén. Devuelve cuántos libros se agregaron.
 * Solo calcula fingerprint para URIs desconocidos (los ya vistos se
 * saltean por URI, que es barato).
 */
export async function scanLibraryFolders(folderUris: string[]): Promise<number> {
  let added = 0;
  const ignoredIds = await getIgnoredBookIds();

  for (const folderUri of folderUris) {
    let entries: string[] = [];
    try {
      entries = await StorageAccessFramework.readDirectoryAsync(folderUri);
      console.log(`[scan] carpeta ${folderUri.slice(-30)}: ${entries.length} entradas`);
    } catch (error) {
      console.warn('[scan] no se pudo leer la carpeta:', error instanceof Error ? error.message : error);
      // Permiso revocado o carpeta eliminada: se ignora esta carpeta.
      continue;
    }

    for (const fileUri of entries) {
      const displayName = getDisplayNameFromSafUri(fileUri);
      const extension = getExtension(displayName);
      const mimeType = SUPPORTED_EXTENSIONS[extension];
      if (!mimeType) continue;

      try {
        // Barato: si este URI ya está en la biblioteca, no hay nada que hacer.
        const knownByUri = await bookRepository.getBookByUri(fileUri);
        if (knownByUri) continue;

        const info = await FileSystem.getInfoAsync(fileUri);
        if (!info.exists || info.isDirectory) continue;

        const fileSize = 'size' in info ? info.size : undefined;
        const id = await createBookFingerprint(fileUri, fileSize, `${displayName}:${fileSize ?? 0}`);

        // Mismo contenido ya importado (p. ej. copia local previa): no duplicar.
        // Y si el usuario lo eliminó de la biblioteca, respetar esa decisión.
        if (ignoredIds.has(id)) continue;
        const knownById = await bookRepository.getBookById(id);
        if (knownById) continue;

        const now = new Date().toISOString();
        const book: Book = {
          id,
          sagaId: null,
          name: displayName,
          title: null,
          author: null,
          coverUri: null,
          orderIndex: 0,
          uri: fileUri,
          type: mimeType,
          importedAt: now,
          lastOpenedAt: now,
        };
        await bookRepository.saveBook(book);
        added += 1;
        console.log(`[scan] agregado: ${displayName}`);
      } catch (error) {
        console.warn(`[scan] fallo ${displayName}:`, error instanceof Error ? error.message : error);
        // Un archivo ilegible no debe frenar el resto del escaneo.
        continue;
      }
    }
  }

  return added;
}

/**
 * El extractor PDF nativo necesita un archivo local (file://).
 * Para libros descubiertos por escaneo (content://) se crea una copia
 * dentro de la app la primera vez que se abren, y se reutiliza después.
 */
export async function ensureLocalPdfCopy(bookId: string, sourceUri: string): Promise<string> {
  if (!FileSystem.documentDirectory) {
    throw new Error('La carpeta local de documentos no esta disponible en este dispositivo.');
  }

  const directory = `${FileSystem.documentDirectory}documents`;
  const dirInfo = await FileSystem.getInfoAsync(directory);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }

  const destination = `${directory}/${bookId}.pdf`;
  const destinationInfo = await FileSystem.getInfoAsync(destination);
  if (!destinationInfo.exists) {
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
  }

  return destination;
}
