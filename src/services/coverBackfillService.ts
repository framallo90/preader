/**
 * Tapas de los libros que entraron por escaneo y todavía no se abrieron.
 *
 * Hasta ahora la tapa se dibujaba al ABRIR el libro, así que una carpeta recién
 * escaneada era una pared de cuadraditos de colores con dos letras hasta que
 * fueras abriendo uno por uno. Esto las va generando de fondo.
 *
 * Dos reglas que no se negocian:
 *
 *  1. **Solo desde el Inicio.** El módulo nativo de PDF mantiene UN documento
 *     abierto por vez (el del libro en pantalla). Si esto corriera mientras leés,
 *     cada tapa cerraría tu libro y lo volvería a abrir: un desastre. El Inicio
 *     lo arranca al tomar foco y lo corta al salir.
 *  2. **De a una y cediendo el hilo.** La biblioteca se muestra primero; las
 *     tapas van apareciendo solas, sin trabar el scroll.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';
import { bookRepository } from '../storage/bookRepository';
import { Book } from '../types/storage';
import { parseAttributes, parseManifest, resolveEpubPath } from '../utils/epubStructure';
import { EPUB_MIME_TYPE, isComicFile, isPdfFile } from './bookTypes';
import { renderComicCover, renderPdfCover } from './pdfLocalService';

/** Cuánto se espera entre tapa y tapa, para no comerse el hilo. */
const PAUSE_MS = 120;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEpub(book: Book): boolean {
  return book.type === EPUB_MIME_TYPE || /\.epub$/i.test(book.name);
}

/** Un TXT o un DOCX no tienen tapa adentro: la de letras es la que corresponde. */
export function canHaveCover(book: Book): boolean {
  return isPdfFile(book.type, book.name) || isComicFile(book.type, book.name) || isEpub(book);
}

function directoryOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at >= 0 ? path.slice(0, at) : '';
}

/**
 * Tapa de un EPUB sin parsear el libro entero: container.xml → OPF → la entrada
 * marcada como portada. Son tres lecturas chicas y un archivo extraído.
 */
async function extractEpubCover(bookId: string, uri: string): Promise<string | null> {
  if (!isBardoArchiveAvailable() || !FileSystem.documentDirectory) return null;
  const archive = getBardoArchiveModule();
  try {
    const [containerXml] = await archive.readTextAsync(uri, ['META-INF/container.xml']);
    const opfPath = containerXml ? /full-path\s*=\s*["']([^"']+\.opf)["']/i.exec(containerXml)?.[1] : null;
    if (!opfPath) return null;

    const [opf] = await archive.readTextAsync(uri, [opfPath]);
    if (!opf) return null;

    const manifest = parseManifest(opf);
    let coverHref: string | null = null;
    for (const item of manifest.values()) {
      if (item.properties?.split(/\s+/).includes('cover-image')) {
        coverHref = item.href;
        break;
      }
    }
    if (!coverHref) {
      // EPUB 2: la portada se declara con <meta name="cover" content="id">.
      for (const tag of opf.match(/<meta\b[^>]*>/gi) ?? []) {
        const attrs = parseAttributes(tag);
        if (attrs.name === 'cover' && attrs.content) {
          coverHref = manifest.get(attrs.content)?.href ?? null;
          break;
        }
      }
    }
    if (!coverHref) return null;

    const extension = /\.(jpe?g|png|webp|gif)$/i.exec(coverHref)?.[0]?.toLowerCase() ?? '.jpg';
    const dir = `${FileSystem.documentDirectory}covers`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const target = `${dir}/${bookId}${extension}`;
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    return await archive.extractEntryAsync(uri, resolveEpubPath(directoryOf(opfPath), coverHref), target);
  } catch {
    return null;
  }
}

async function buildCover(book: Book): Promise<string | null> {
  if (isPdfFile(book.type, book.name)) return renderPdfCover(book.id, book.uri);
  if (isComicFile(book.type, book.name)) return renderComicCover(book.id, book.uri);
  if (isEpub(book)) return extractEpubCover(book.id, book.uri);
  return null;
}

export type CoverBackfillOptions = {
  /** Se llama por cada tapa lista, para que la biblioteca la muestre al toque. */
  onCover: (bookId: string, coverUri: string) => void;
  /** true para frenar (el usuario salió del Inicio o abrió un libro). */
  isCancelled: () => boolean;
};

/**
 * Genera las tapas que falten, de a una. Devuelve cuántas hizo.
 * Los libros llegan en el orden en que se ven: primero los de arriba.
 */
// Tapas que fallaron en esta sesión (EPUB sin tapa declarada, archivo que no
// abre): no se reintentan en cada vuelta al Inicio, que volvía a abrir cada
// archivo nativamente para nada.
const failedCovers = new Set<string>();

export async function backfillCovers(books: Book[], options: CoverBackfillOptions): Promise<number> {
  const pending = books.filter((book) => !book.coverUri && canHaveCover(book) && !failedCovers.has(book.id));
  let done = 0;
  for (const book of pending) {
    if (options.isCancelled()) break;
    const coverUri = await buildCover(book);
    if (options.isCancelled()) break;
    if (coverUri) {
      // La fila se actualiza con la tapa; título y autor no se tocan.
      await bookRepository.updateBookMetadata(book.id, { title: null, author: null, coverUri }).catch(() => {});
      options.onCover(book.id, coverUri);
      done += 1;
    } else {
      failedCovers.add(book.id);
    }
    await pause(PAUSE_MS);
  }
  return done;
}
