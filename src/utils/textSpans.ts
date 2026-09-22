/**
 * Rangos [start, end) sobre un texto. Todo lo que parte el libro en pedazos
 * (bloques de lectura, tramos de voz) trabaja con rangos sobre el texto ORIGINAL
 * y nunca arma un string nuevo para después buscarlo: reconstruir con espacios y
 * ubicar con indexOf falla cuando el original tiene saltos de línea, y el error
 * de offsets se acumula a lo largo del libro.
 *
 * Rendimiento: estas funciones corren sobre libros enteros (millones de
 * caracteres) en Hermes, donde un `regex.test` por carácter y cada copia del texto
 * cuestan caro. Por eso los espacios se reconocen por código de carácter y los
 * párrafos se buscan sobre el texto completo, sin copiarlo.
 */
export type Span = { start: number; end: number };

export const spanLength = (span: Span) => span.end - span.start;

/** Mismo conjunto que `\s` en JavaScript, sin pasar por el motor de regex. */
export function isWhitespaceCode(code: number): boolean {
  if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
  if (code < 0x00a0) return false;
  return (
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** Rango sin los espacios de las puntas; null si queda vacío. */
export function trimSpan(text: string, start: number, end: number): Span | null {
  let from = start;
  let to = end;
  while (from < to && isWhitespaceCode(text.charCodeAt(from))) from += 1;
  while (to > from && isWhitespaceCode(text.charCodeAt(to - 1))) to -= 1;
  return to > from ? { start: from, end: to } : null;
}

/** Parte un rango donde `boundary` matchea (el match queda del lado izquierdo). */
export function splitSpan(text: string, span: Span, boundary: RegExp): Span[] {
  const parts: Span[] = [];
  const source = text.slice(span.start, span.end);
  let cursor = 0;
  for (const match of source.matchAll(boundary)) {
    const cut = (match.index ?? 0) + match[0].length;
    const part = trimSpan(text, span.start + cursor, span.start + cut);
    if (part) parts.push(part);
    cursor = cut;
  }
  const rest = trimSpan(text, span.start + cursor, span.end);
  if (rest) parts.push(rest);
  return parts;
}

const PARAGRAPH_BREAK = /\n{2,}/g;

/**
 * Párrafos: separados por una o más líneas en blanco. Se recorren sobre el texto
 * completo con un regex global (sin copiar el libro para partirlo).
 */
export function paragraphSpans(text: string): Span[] {
  const whole = trimSpan(text, 0, text.length);
  if (!whole) return [];

  const parts: Span[] = [];
  let cursor = whole.start;
  PARAGRAPH_BREAK.lastIndex = whole.start;
  let match: RegExpExecArray | null;
  while ((match = PARAGRAPH_BREAK.exec(text)) !== null) {
    const cut = match.index + match[0].length;
    if (cut > whole.end) break;
    const part = trimSpan(text, cursor, cut);
    if (part) parts.push(part);
    cursor = cut;
  }
  PARAGRAPH_BREAK.lastIndex = 0;
  const rest = trimSpan(text, cursor, whole.end);
  if (rest) parts.push(rest);
  return parts;
}
