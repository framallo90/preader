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

/**
 * ¿Este libro está adentro de esta carpeta? Se compara por RUTA.
 *
 * Antes se comparaba el "tree id" de la URI, que es por dónde se descubrió el
 * archivo. Eso preguntaba en realidad "¿este libro se encontró escaneando ESTA
 * carpeta?", y daba que no en un caso muy común: los libros que ya estaban en la
 * biblioteca desde antes (importados a mano, o encontrados escaneando la carpeta
 * de arriba) tienen la URI de aquella otra raíz. Al agregar la carpeta nueva,
 * aparecía con **0 libros** y sus libros caían en "Otros libros".
 *
 * La ruta no depende de por dónde entró el archivo, así que esto los reconoce.
 * Devuelve el largo de la ruta de la carpeta cuando hay coincidencia, para poder
 * quedarse con la MÁS específica si tenés agregadas una carpeta y una subcarpeta
 * suya; -1 si el libro no está adentro.
 */
export function folderMatchDepth(bookUri: string, rootFolderUri: string): number {
  const root = getSafFolderPath(rootFolderUri);
  const full = getSafFolderPath(bookUri);
  if (root === '' || full === '') return -1;
  // La barra final evita que "Libros" se quede con lo de "Libros2".
  return full.startsWith(`${root}/`) ? root.length : -1;
}

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
