/**
 * La cita compartida como imagen: qué texto va y de qué tamaño.
 *
 * Lógica pura (sin pantalla) para poder probarla: la imagen la arma
 * QuoteShareSheet con esto.
 */

/** Más que esto no entra en una imagen legible: se corta en una palabra y se pone "…". */
export const MAX_QUOTE_CHARS = 600;

/** Comillas y rayas que el texto del libro puede traer en los bordes. */
const EDGE_MARKS = /^[\s"'«»“”‘’—–-]+|[\s"'«»“”‘’]+$/g;

/**
 * Texto de la cita listo para la imagen: sin saltos de línea sueltos (en el
 * libro eran fin de renglón, no de párrafo), sin comillas en los bordes (la
 * tarjeta ya pone las suyas) y cortado si es muy largo.
 */
export function prepareQuote(raw: string, max = MAX_QUOTE_CHARS): string {
  const plano = raw.replace(/\s+/g, ' ').replace(EDGE_MARKS, '').trim();
  if (plano.length <= max) return plano;
  const corte = plano.lastIndexOf(' ', max);
  const base = plano.slice(0, corte > max * 0.6 ? corte : max).replace(/[\s,;:.—–-]+$/, '');
  return `${base}…`;
}

/** Tamaño de letra según el largo: una frase corta se luce grande, un párrafo no. */
export function quoteFontSize(text: string): number {
  const n = text.length;
  if (n <= 90) return 26;
  if (n <= 180) return 22;
  if (n <= 320) return 19;
  return 16;
}
