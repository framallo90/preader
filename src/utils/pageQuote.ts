/**
 * Dónde cae, dentro del texto del libro, una cita sacada de la página cruda.
 *
 * Pdfium devuelve el texto tal cual está en el PDF: con los renglones cortados
 * donde los cortó la maquetación y con los espacios que haya. El texto del
 * libro, en cambio, viene unido y limpiado, así que el índice de Pdfium no sirve
 * tal cual y la cita tampoco coincide carácter a carácter.
 *
 * La comparación se hace SIN espacios ni saltos, guardando de dónde salió cada
 * carácter: eso hace que "una frase\ncortada" encuentre a "una frase cortada",
 * y el índice que vuelve es del texto del libro de verdad.
 */

/** Con menos que esto, buscar da falsos positivos en cualquier página. */
const MIN_QUOTE = 12;
/** Si la cita entera no aparece, alcanza con que aparezca su arranque. */
const PREFIX = 40;

function compact(value: string): { text: string; at: number[] } {
  const text: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === ' ') continue;
    text.push(c);
    at.push(i);
  }
  return { text: text.join(''), at };
}

/**
 * Índice absoluto donde empieza `quote` dentro de `haystack`, buscando sólo
 * entre `from` y `to` (el tramo de esa página). null si no aparece.
 */
export function findQuoteIndex(haystack: string, quote: string, from: number, to: number): number | null {
  const desde = Math.max(from, 0);
  const hasta = Math.min(to, haystack.length);
  if (hasta <= desde) return null;

  const aguja = compact(quote).text;
  if (aguja.length < MIN_QUOTE) return null;

  const pajar = compact(haystack.slice(desde, hasta));
  let at = pajar.text.indexOf(aguja);
  if (at < 0 && aguja.length > PREFIX) at = pajar.text.indexOf(aguja.slice(0, PREFIX));
  if (at < 0) return null;

  return desde + pajar.at[at];
}
