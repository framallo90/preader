/**
 * Rangos [start, end) sobre un texto. Todo lo que parte el libro en pedazos
 * (bloques de lectura, tramos de voz) trabaja con rangos sobre el texto ORIGINAL
 * y nunca arma un string nuevo para después buscarlo: reconstruir con espacios y
 * ubicar con indexOf falla cuando el original tiene saltos de línea, y el error
 * de offsets se acumula a lo largo del libro.
 */
export type Span = { start: number; end: number };

export const spanLength = (span: Span) => span.end - span.start;

/** Rango sin los espacios de las puntas; null si queda vacío. */
export function trimSpan(text: string, start: number, end: number): Span | null {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
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

/** Párrafos: separados por una o más líneas en blanco. */
export function paragraphSpans(text: string): Span[] {
  const whole = trimSpan(text, 0, text.length);
  return whole ? splitSpan(text, whole, /\n{2,}/g) : [];
}
