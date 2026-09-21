/**
 * Ruta legible de una carpeta SAF ("primary:Libros/Viejos"), igual para la URI
 * que devuelve el selector (…/tree/<ruta>) que para una subcarpeta encontrada al
 * escanear (…/tree/<raíz>/document/<ruta>). Es la clave de las exclusiones.
 */
export function getSafFolderPath(uri: string): string {
  const marker = uri.includes('/document/') ? '/document/' : '/tree/';
  const encoded = uri.split(marker).pop() ?? '';
  try {
    return decodeURIComponent(encoded).replace(/\/+$/, '');
  } catch {
    return encoded;
  }
}

export function isFolderExcluded(folderUri: string, excludedPaths: string[]): boolean {
  if (excludedPaths.length === 0) return false;
  const path = getSafFolderPath(folderUri);
  return excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
}
