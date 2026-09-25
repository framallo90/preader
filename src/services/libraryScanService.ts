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
import { Platform } from 'react-native';

import { DocumentTreeEntry, getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';

import { getDatabase } from '../storage/database';
import { bookRepository } from '../storage/bookRepository';
import { Book, NEW_BOOK_DEFAULTS } from '../types/storage';
import { isFolderExcluded } from '../utils/safPaths';
import { createBookFingerprint, legacyLargeFileFingerprint, usesContentIdForLargeFile } from '../utils/documentId';

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
    if (count > 0) {
      await saveIgnoredBookIds(new Set());
      requestScanOnNextFocus();
    }
    return count;
  });
}

/**
 * Pide al usuario que elija una carpeta. Devuelve su URI SAF o null.
 *
 * Storage Access Framework es de Android. En iOS el equivalente es el selector
 * de carpetas de Archivos con un "security-scoped bookmark", que todavía no
 * está (ver el plan de iOS): mientras tanto, acá no hay carpeta que elegir.
 */
export async function requestLibraryFolder(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
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
/**
 * ¿El archivo al que apunta esta URI sigue estando?
 *
 * Con `content://` (SAF), preguntar por un documento que se movió o se borró
 * **tira excepción** en vez de contestar "no existe". Devolver `true` ahí —que
 * era lo que hacía— dejaba al libro apuntando para siempre a la ruta vieja: si
 * movías un archivo de carpeta, no volvía a abrir y en la biblioteca seguía
 * apareciendo en la carpeta donde ya no está.
 *
 * Que un `content://` falle se toma entonces como que no está. El riesgo es
 * bajo: quien llama sólo usa esto para reapuntar a un archivo que ACABA de
 * encontrar en el escaneo con la misma huella de contenido, así que en el peor
 * caso el libro queda apuntando a una copia igual. Para `file://`, que sí
 * contesta bien, se sigue confiando en la respuesta.
 */
async function uriExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return !uri.startsWith('content://');
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

// Alguien pidió que el próximo Inicio escanee sin esperar el intervalo:
// "Restaurar ocultos" desde Ajustes prometía que los libros "volverán a
// aparecer al volver al inicio", pero el Inicio había escaneado hacía menos de
// dos minutos y se lo salteaba. El Inicio consume el pedido al enfocarse.
let scanRequested = false;

export function requestScanOnNextFocus(): void {
  scanRequested = true;
}

export function consumeScanRequest(): boolean {
  const requested = scanRequested;
  scanRequested = false;
  return requested;
}

let scanInFlight: Promise<ScanResult> | null = null;
let scanInFlightKey = '';

/** Qué dejó un escaneo. */
export type ScanResult = {
  /**
   * CUÁNTO CAMBIÓ: libros nuevos más libros que cambiaron de ruta porque los
   * moviste. Quien llama recarga la lista si esto es mayor que cero; contando
   * solo los nuevos, mover un archivo de carpeta dejaba la pantalla con la ruta
   * vieja.
   */
  changed: number;
  /**
   * Carpetas autorizadas que no se pudieron leer (el permiso se perdió, la
   * carpeta se borró o está en una tarjeta que no está). Antes esto sólo quedaba
   * en el log: la carpeta figuraba en Ajustes y "no aparecían" los libros sin
   * que nada dijera por qué.
   */
  unreadable: string[];
};

/** Escanea las carpetas autorizadas y devuelve qué cambió y qué no se pudo leer. */
export async function scanLibraryFolders(folderUris: string[], excludedPaths: string[] = []): Promise<ScanResult> {
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

async function runScan(folderUris: string[], excludedPaths: string[]): Promise<ScanResult> {
  const ignoredIds = await getIgnoredBookIds();
  const unreadable: string[] = [];
  // URIs ya conocidos, de una sola consulta: el escaneo solo mira lo nuevo.
  const knownUris = new Set(await bookRepository.listBookUris());
  let added = 0;
  // Un archivo que MOVISTE de carpeta no suma un libro nuevo, pero sí cambia su
  // ruta: si esto no se contara, el Inicio se quedaba mostrando la ruta vieja
  // (y el libro no abría) hasta que algo más recargara la lista.
  let relocated = 0;

  const scanFolder = async (folderUri: string, depth: number): Promise<void> => {
    let entries: DocumentTreeEntry[] = [];
    try {
      entries = await listFolder(folderUri);
    } catch (error) {
      console.warn('[scan] no se pudo leer la carpeta:', error instanceof Error ? error.message : error);
      // Sólo las carpetas que autorizaste: una subcarpeta ilegible no es algo
      // que puedas arreglar desde la app.
      if (depth === 0) unreadable.push(folderUri);
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
        let existing = await bookRepository.getBookById(id);
        // Un archivo grande escaneado por una versión anterior tiene el id
        // viejo (nombre+tamaño): si se movió, se lo reconoce por ese id y se
        // relocaliza, en vez de sumar un libro nuevo sin progreso.
        if (!existing && usesContentIdForLargeFile(fileSize)) {
          existing = await bookRepository.getBookById(await legacyLargeFileFingerprint(entry.name, fileSize as number));
        }
        if (existing) {
          // El mismo libro en otra carpeta o con otro nombre: si el archivo al
          // que apuntaba YA NO ESTÁ, se movió y hay que corregir la ruta (si no,
          // el libro no abre más). Si el viejo sigue existiendo, esto es una
          // segunda copia: se deja como estaba, porque reapuntar en cada escaneo
          // hacía que el libro fuera y viniera entre las dos rutas.
          if (existing.uri !== entry.uri && !(await uriExists(existing.uri))) {
            await bookRepository.relocateBook(existing.id, entry.uri, entry.name);
            knownUris.add(entry.uri);
            relocated += 1;
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

  return { changed: added + relocated, unreadable };
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
