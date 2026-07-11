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

/** Offset representativo (mitad) del texto de una página. */
export function charForPage(page: number, pageOffsets: number[], totalLength: number): number {
  const safePage = Math.min(Math.max(page, 0), pageOffsets.length - 1);
  const start = pageOffsets[safePage] ?? 0;
  const end = safePage + 1 < pageOffsets.length ? pageOffsets[safePage + 1] : totalLength;
  return Math.min(totalLength, Math.floor((start + Math.max(end, start)) / 2));
}
