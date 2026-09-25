/**
 * Mapeo exacto texto↔página usando los offsets por página que publica el
 * server (dónde empieza cada página dentro de fullText). Con esto la app sabe
 * en qué página va la voz aunque las primeras páginas (tapa, índice) casi no
 * tengan texto — el mapeo proporcional fallaba justo ahí.
 */

/** Página que contiene el offset dado (la mayor con inicio <= abs). */
export function pageForChar(absoluteChar: number, pageOffsets: number[]): number {
  let low = 0;
  let high = pageOffsets.length - 1;
  let result = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (pageOffsets[mid] <= absoluteChar) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** Offset donde EMPIEZA el texto de una página. */
export function charForPage(page: number, pageOffsets: number[], totalLength: number): number {
  const safePage = Math.min(Math.max(page, 0), pageOffsets.length - 1);
  // El PRINCIPIO de la página, no el medio: al pasar páginas a mano y tocar
  // Escuchar, la voz arrancaba a mitad de página, a mitad de oración; un PDF
  // recién abierto arrancaba a mitad de la página 1; el marcador de página
  // citaba desde el medio. Las páginas vacías (mismo offset que la siguiente)
  // las desambigua pageForProgress con la página conocida, que se guarda junto
  // al progreso.
  return Math.min(totalLength, pageOffsets[safePage] ?? 0);
}

/**
 * Página de una posición guardada. Varias páginas pueden empezar en el MISMO offset
 * (láminas, páginas en blanco, un cómic entero): ahí el texto solo no alcanza para
 * saber en cuál se estaba, y pageForChar devuelve siempre la última. Si se conoce
 * la página (`knownPage`) y es compatible con el offset, manda la página.
 */
export function pageForProgress(
  absoluteChar: number,
  knownPage: number | null,
  pageOffsets: number[],
  totalLength: number,
): number {
  if (knownPage !== null && knownPage >= 0 && knownPage < pageOffsets.length) {
    const start = pageOffsets[knownPage];
    const end = knownPage + 1 < pageOffsets.length ? pageOffsets[knownPage + 1] : totalLength;
    if (absoluteChar >= start && absoluteChar <= Math.max(end, start)) return knownPage;
  }
  return pageForChar(absoluteChar, pageOffsets);
}
