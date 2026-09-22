/**
 * Qué formato es un archivo, mirando su nombre y su MIME. Vive aparte del
 * registro de parsers a propósito: el Inicio, la ficha del libro y el selector
 * solo necesitan ESTO, y al importarlo desde el registro arrastraban también
 * mammoth y JSZip (que pesan) al arranque de la app, antes de que se viera la
 * biblioteca. Acá no se importa ningún parser.
 */

export const PDF_MIME_TYPE = 'application/pdf';
export const EPUB_MIME_TYPE = 'application/epub+zip';
export const TXT_MIME_TYPE = 'text/plain';
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Tipo con el que se guarda un cómic, venga en el contenedor que venga. */
export const COMIC_MIME_TYPE = 'application/x-comic';

const COMIC_MIME_TYPES = [
  COMIC_MIME_TYPE,
  'application/vnd.comicbook+zip',
  'application/vnd.comicbook-rar',
  'application/x-cbz',
  'application/x-cbr',
  'application/x-cb7',
  'application/x-cbt',
];

// Un cómic también llega como archivo comprimido común, con las imágenes adentro.
const ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-rar',
  'application/x-7z-compressed',
  'application/x-tar',
];

const COMIC_EXTENSION = /\.(cbz|cbr|cb7|cbt)$/i;
const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar)$/i;

export const SUPPORTED_MIME_TYPES = [PDF_MIME_TYPE, EPUB_MIME_TYPE, TXT_MIME_TYPE, DOCX_MIME_TYPE] as const;

/**
 * Lo que se le pide al selector de archivos de Android. Incluye octet-stream
 * porque muchos proveedores no conocen .cbr/.cb7 y los reportan así: filtrando
 * solo por los tipos "correctos" esos archivos ni aparecen. La validación real la
 * hace resolveBookType, por extensión.
 */
export const PICKER_MIME_TYPES = [
  ...SUPPORTED_MIME_TYPES,
  ...COMIC_MIME_TYPES,
  ...ARCHIVE_MIME_TYPES,
  'application/octet-stream',
];

export function isPdfFile(mimeType: string | null | undefined, fileName?: string | null): boolean {
  return mimeType === PDF_MIME_TYPE || Boolean(fileName && /\.pdf$/i.test(fileName));
}

export function isComicFile(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (mimeType && COMIC_MIME_TYPES.includes(mimeType)) return true;
  return Boolean(fileName && COMIC_EXTENSION.test(fileName));
}

/**
 * Tipo con el que se guarda el libro, o null si el formato no se soporta. La
 * extensión manda sobre el MIME: es lo único confiable en Android.
 */
export function resolveBookType(mimeType: string | null | undefined, fileName: string): string | null {
  if (/\.pdf$/i.test(fileName)) return PDF_MIME_TYPE;
  if (/\.epub$/i.test(fileName)) return EPUB_MIME_TYPE;
  if (/\.txt$/i.test(fileName)) return TXT_MIME_TYPE;
  if (/\.docx$/i.test(fileName)) return DOCX_MIME_TYPE;
  if (COMIC_EXTENSION.test(fileName) || ARCHIVE_EXTENSION.test(fileName)) return COMIC_MIME_TYPE;
  if (!mimeType) return null;
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)) return mimeType;
  if (COMIC_MIME_TYPES.includes(mimeType) || ARCHIVE_MIME_TYPES.includes(mimeType)) return COMIC_MIME_TYPE;
  return null;
}
