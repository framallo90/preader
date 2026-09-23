import { getSafFolderPath } from './safPaths';

/**
 * En qué subcarpeta cae un libro, dentro de la carpeta que escaneaste.
 *
 * El escaneo entra en las subcarpetas pero guarda sólo el nombre del archivo,
 * así que el `name` del libro no sabe de dónde salió: por eso la biblioteca
 * mostraba los 95 libros de una carpeta con subcarpetas todos mezclados.
 *
 * La ruta sí está en la URI de SAF, que para un archivo encontrado al escanear
 * es `…/tree/<raíz>/document/<ruta completa>`. De ahí sale la subcarpeta
 * relativa, sin tocar la base ni volver a escanear: los libros que ya están
 * guardados se reagrupan solos.
 */

/** Ruta de la subcarpeta relativa a la raíz, o '' si el libro está suelto en la raíz. */
export function getSubfolderPath(bookUri: string, rootFolderUri: string): string {
  const root = getSafFolderPath(rootFolderUri);
  const full = getSafFolderPath(bookUri);
  if (root === '' || full === '') return '';
  if (full === root) return '';
  if (!full.startsWith(`${root}/`)) return '';

  const relative = full.slice(root.length + 1);
  const corte = relative.lastIndexOf('/');
  // Sin barra, el archivo cuelga de la raíz: no hay subcarpeta.
  return corte < 0 ? '' : relative.slice(0, corte);
}

/**
 * Cómo se muestra una subcarpeta en la lista.
 *
 * Anidada hondo, la ruta entera no entra en pantalla y lo que importa es el
 * último tramo; los de arriba quedan como migas para no perder el contexto.
 */
export function formatSubfolderLabel(path: string): string {
  if (path === '') return '';
  const partes = path.split('/');
  if (partes.length <= 2) return partes.join(' / ');
  return `… / ${partes.slice(-2).join(' / ')}`;
}

/** Ordena subcarpetas: primero la raíz (''), después alfabético natural. */
export function compareSubfolders(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}
