/**
 * libraryScanService.ts — biblioteca por descubrimiento (modelo ReadEra).
 *
 * El usuario autoriza carpetas via Storage Access Framework; en cada
 * escaneo se detectan archivos soportados nuevos y se agregan solos a la
 * biblioteca, sin copiarlos (se referencian in-place por content://).
 * Los libros se abren donde están; solo si un proveedor no permite leerlos en
 * el lugar se copian dentro de la app (ensureLocalPdfCopy).
 *
 * El listado de carpetas lo hace el módulo nativo en UNA consulta por carpeta
 * (nombre, tamaño y tipo de cada entrada). Con expo-file-system eran dos o tres
 * llamadas por archivo: escanear una carpeta grande tardaba segundos, y se hacía
 * cada vez que se volvía al Inicio.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { DocumentTreeEntry, getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';

import { getDatabase } from '../storage/database';
import { bookRepository } from '../storage/bookRepository';
import { Book, NEW_BOOK_DEFAULTS } from '../types/storage';
import { isFolderExcluded } from '../utils/safPaths';
import { createBookFingerprint } from '../utils/documentId';

const { StorageAccessFramework } = FileSystem;

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Cómics: el contenedor real (zip, rar, 7z, tar) se detecta al abrir.
  '.cbz': 'application/x-comic',
  '.cbr': 'application/x-comic',
  '.cb7': 'application/x-comic',
  '.cbt': 'application/x-comic',
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

// La lista de ignorados se lee, se modifica y se guarda entera: dos borrados
// casi juntos leían la misma copia y el segundo pisaba al primero (el libro
// borrado reaparecía solo en el próximo escaneo). Se encadenan.
let ignoredChain: Promise<unknown> = Promise.resolve();

function serializeIgnored<T>(task: () => Promise<T>): Promise<T> {
  const next = ignoredChain.then(task, task);
  ignoredChain = next.catch(() => {});
  return next;
}

export async function addIgnoredBook(bookId: string): Promise<void> {
  await serializeIgnored(async () => {
    const ids = await getIgnoredBookIds();
    ids.add(bookId);
    await saveIgnoredBookIds(ids);
  });
}

export async function clearIgnoredBook(bookId: string): Promise<void> {
  await serializeIgnored(async () => {
    const ids = await getIgnoredBookIds();
    if (ids.delete(bookId)) {
      await saveIgnoredBookIds(ids);
    }
  });
}

/**
 * Vacía la lista de ignorados: los libros borrados que sigan en carpetas
 * escaneadas vuelven a aparecer en el próximo escaneo. Devuelve cuántos había.
 */
export async function getIgnoredBooksCount(): Promise<number> {
  return (await getIgnoredBookIds()).size;
}

export async function restoreIgnoredBooks(): Promise<number> {
  // También encolado: un borrado en vuelo escribiendo después del restore
  // dejaba ese libro oculto igual.
  return serializeIgnored(async () => {
    const ids = await getIgnoredBookIds();
    const count = ids.size;
    if (count > 0) await saveIgnoredBookIds(new Set());
    return count;
  });
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
const MAX_SCAN_DEPTH = 4;

/** Entradas de una carpeta SAF: nativo si está, expo-file-system si no. */
/** ¿El archivo sigue donde dice la fila? Ante la duda, se asume que sí. */
async function uriExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return true;
  }
}

async function listFolder(folderUri: string): Promise<DocumentTreeEntry[]> {
  if (isBardoArchiveAvailable()) {
    return getBardoArchiveModule().listDocumentTreeAsync(folderUri);
  }
  const uris = await StorageAccessFramework.readDirectoryAsync(folderUri);
  const entries: DocumentTreeEntry[] = [];
  for (const uri of uris) {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) continue;
    entries.push({
      uri,
      name: getDisplayNameFromSafUri(uri),
      isDirectory: info.isDirectory,
      size: 'size' in info && typeof info.size === 'number' ? info.size : null,
    });
  }
  return entries;
}

let scanInFlight: Promise<number> | null = null;
let scanInFlightKey = '';

export async function scanLibraryFolders(folderUris: string[], excludedPaths: string[] = []): Promise<number> {
  // Dos pantallas pidiendo EL MISMO escaneo a la vez comparten el mismo trabajo.
  // Si las carpetas cambiaron (recién agregaste una), es otro pedido y se encola:
  // antes devolvía el resultado del escaneo viejo y la carpeta nueva no aparecía.
  const key = `${folderUris.join('|')}##${excludedPaths.join('|')}`;
  if (scanInFlight && scanInFlightKey === key) return scanInFlight;
  const previous = scanInFlight;
  const run = (async () => {
    if (previous) await previous.catch(() => {});
    return runScan(folderUris, excludedPaths);
  })();
  scanInFlight = run;
  scanInFlightKey = key;
  void run.catch(() => {}).finally(() => {
    if (scanInFlight === run) {
      scanInFlight = null;
      scanInFlightKey = '';
    }
  });
  return run;
}

async function runScan(folderUris: string[], excludedPaths: string[]): Promise<number> {
  const ignoredIds = await getIgnoredBookIds();
  // URIs ya conocidos, de una sola consulta: el escaneo solo mira lo nuevo.
  const knownUris = new Set(await bookRepository.listBookUris());
  let added = 0;

  const scanFolder = async (folderUri: string, depth: number): Promise<void> => {
    let entries: DocumentTreeEntry[] = [];
    try {
      entries = await listFolder(folderUri);
    } catch (error) {
      console.warn('[scan] no se pudo leer la carpeta:', error instanceof Error ? error.message : error);
      return; // permiso revocado / carpeta borrada
    }

    for (const entry of entries) {
      try {
        if (entry.isDirectory) {
          if (isFolderExcluded(entry.uri, excludedPaths)) continue;
          if (depth < MAX_SCAN_DEPTH) await scanFolder(entry.uri, depth + 1);
          continue;
        }

        const mimeType = SUPPORTED_EXTENSIONS[getExtension(entry.name)];
        if (!mimeType) continue;
        if (knownUris.has(entry.uri)) continue;

        const fileSize = entry.size ?? undefined;
        const id = await createBookFingerprint(entry.uri, fileSize, `${entry.name}:${fileSize ?? 0}`);

        // Mismo contenido ya importado, o eliminado por el usuario: no duplicar.
        if (ignoredIds.has(id)) continue;
        const existing = await bookRepository.getBookById(id);
        if (existing) {
          // El mismo libro en otra carpeta o con otro nombre: si el archivo al
          // que apuntaba YA NO ESTÁ, se movió y hay que corregir la ruta (si no,
          // el libro no abre más). Si el viejo sigue existiendo, esto es una
          // segunda copia: se deja como estaba, porque reapuntar en cada escaneo
          // hacía que el libro fuera y viniera entre las dos rutas.
          if (existing.uri !== entry.uri && !(await uriExists(existing.uri))) {
            await bookRepository.saveBook({ ...existing, uri: entry.uri, name: entry.name });
            knownUris.add(entry.uri);
          }
          continue;
        }

        const now = new Date().toISOString();
        const book: Book = {
          id, name: entry.name, title: null, author: null, coverUri: null, summary: null,
          uri: entry.uri, type: mimeType, importedAt: now, lastOpenedAt: now,
          ...NEW_BOOK_DEFAULTS,
        };
        await bookRepository.saveBook(book);
        knownUris.add(entry.uri);
        added += 1;
      } catch (error) {
        console.warn(`[scan] fallo ${entry.name}:`, error instanceof Error ? error.message : error);
        continue; // un archivo/carpeta ilegible no frena el resto del escaneo
      }
    }
  };

  for (const folderUri of folderUris) {
    await scanFolder(folderUri, 0);
  }

  return added;
}

/**
 * Plan B para un content:// que no se puede leer en el lugar (un proveedor en la
 * nube que entrega el archivo por un pipe, sin seek): se copia adentro de la app.
 * Lo normal es abrir el archivo donde está, sin copiar nada.
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
