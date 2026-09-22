import { TextBlock } from '../types/document';
import { Span, paragraphSpans, spanLength, trimSpan } from './textSpans';

const TARGET_BLOCK_LENGTH = 280;
const HARD_BLOCK_LENGTH = 420;
const MIN_BLOCK_LENGTH = 110;
const SENTENCE_PATTERN = /[^.!?]+[.!?]+[\])'"\u00BB\u201D]*|[^.!?]+$/g;
const HYPHENATED_LINE_BREAK_PATTERN = /([A-Za-z\u00C0-\u024F])-\n([A-Za-z\u00C0-\u024F])/g;

/** Oraciones de un párrafo, como rangos sobre el texto original. */
function sentenceSpans(fullText: string, paragraph: Span): Span[] {
  const source = fullText.slice(paragraph.start, paragraph.end);
  const spans: Span[] = [];
  for (const match of source.matchAll(SENTENCE_PATTERN)) {
    const from = paragraph.start + (match.index ?? 0);
    const span = trimSpan(fullText, from, from + match[0].length);
    if (span) spans.push(span);
  }
  return spans.length > 0 ? spans : [paragraph];
}

function findSplitPoint(value: string, maxLength: number) {
  const slice = value.slice(0, maxLength);
  const preferredSplit = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('; '),
    slice.lastIndexOf(', '),
    slice.lastIndexOf(' '),
    slice.lastIndexOf('\n'),
  );

  return preferredSplit > 80 ? preferredSplit + 1 : maxLength;
}

/** Una oración más larga que un bloque se parte en pausas naturales. */
function chunkLongSentence(fullText: string, sentence: Span): Span[] {
  const parts: Span[] = [];
  let remaining: Span | null = sentence;

  while (remaining && spanLength(remaining) > HARD_BLOCK_LENGTH) {
    // Solo hace falta mirar el tramo donde puede caer el corte (copiar todo el
    // resto en cada vuelta era cuadrático en una "oración" gigante sin puntos).
    const splitPoint = findSplitPoint(
      fullText.slice(remaining.start, Math.min(remaining.end, remaining.start + HARD_BLOCK_LENGTH)),
      HARD_BLOCK_LENGTH,
    );
    const part = trimSpan(fullText, remaining.start, remaining.start + splitPoint);
    if (part) parts.push(part);
    remaining = trimSpan(fullText, remaining.start + splitPoint, remaining.end);
  }

  if (remaining) parts.push(remaining);
  return parts;
}

// Las nueve limpiezas, en orden. Cada una es una pasada sobre el texto.
const NORMALIZE_STEPS: [RegExp, string][] = [
  [/\r\n/g, '\n'],
  [/\r/g, '\n'],
  [HYPHENATED_LINE_BREAK_PATTERN, '$1$2'],
  [/\u0000/g, ''],
  [/\u00A0/g, ' '],
  [/[ \t]+\n/g, '\n'],
  [/\n{3,}/g, '\n\n'],
  [/[ \t]{2,}/g, ' '],
];

/** Arriba de esto, el texto se limpia por tramos en vez de entero. */
const NORMALIZE_CHUNK_THRESHOLD = 2 * 1024 * 1024;
const NORMALIZE_CHUNK = 512 * 1024;

function normalizeOnce(value: string): string {
  let out = value;
  for (const [pattern, replacement] of NORMALIZE_STEPS) out = out.replace(pattern, replacement);
  return out;
}

export function normalizeExtractedText(value: string) {
  // Cada `.replace()` aloca un texto nuevo del tamaño del libro: en un TXT o
  // un DOCX grande (que se normalizan ENTEROS, no por página como el PDF) son
  // nueve copias completas vivas a la vez. Pasado cierto tamaño se limpia por
  // tramos: el pico de memoria baja de nueve copias del libro a nueve de medio
  // mega. Se corta en un salto de línea para no partir ninguna de las reglas.
  if (value.length <= NORMALIZE_CHUNK_THRESHOLD) return normalizeOnce(value).trim();

  const parts: string[] = [];
  let from = 0;
  while (from < value.length) {
    let to = Math.min(from + NORMALIZE_CHUNK, value.length);
    if (to < value.length) {
      const at = value.lastIndexOf('\n', to);
      // +1 para quedarnos CON el salto: las reglas de renglón lo necesitan.
      if (at > from) to = at + 1;
    }
    parts.push(normalizeOnce(value.slice(from, to)));
    from = to;
  }
  // Una pasada final sobre lo unido: arregla lo que quedó justo en los cortes.
  return normalizeOnce(parts.join('')).trim();
}

/**
 * Bloques de lectura. Cada bloque ES un rango del texto original:
 * `fullText.slice(startChar, endChar) === text`, siempre. De ese invariante
 * dependen el progreso, el capítulo actual, el resaltado de la palabra que suena
 * y la posición de marcadores y notas.
 *
 * La versión anterior unía oraciones con un espacio y ubicaba el resultado con
 * indexOf. Con saltos de línea entre oraciones (cualquier PDF) no lo encontraba y
 * caía a un offset aproximado: en un libro real, 1 de cada 4 bloques quedaba
 * apuntando a otro lugar del texto.
 */
export function buildTextBlocks(fullText: string): TextBlock[] {
  // (Sin `fullText.trim()`: copiaba el libro entero solo para ver si está vacío.)
  if (!/\S/.test(fullText)) {
    return [];
  }

  const blockSpans: Span[] = [];

  for (const paragraph of paragraphSpans(fullText)) {
    let current: Span | null = null;

    for (const sentence of sentenceSpans(fullText, paragraph)) {
      for (const chunk of chunkLongSentence(fullText, sentence)) {
        if (!current) {
          current = chunk;
          continue;
        }

        const candidateLength = chunk.end - current.start;
        if (candidateLength <= TARGET_BLOCK_LENGTH || spanLength(current) < MIN_BLOCK_LENGTH) {
          current = { start: current.start, end: chunk.end };
          continue;
        }

        blockSpans.push(current);
        current = chunk;
      }
    }

    // Un bloque nunca cruza de un párrafo a otro.
    if (current) blockSpans.push(current);
  }

  if (blockSpans.length === 0) {
    const whole = trimSpan(fullText, 0, fullText.length);
    if (whole) blockSpans.push(whole);
  }

  return blockSpans.map((span, index) => makeTextBlock(fullText, index, span.start, span.end));
}

/**
 * Un bloque que NO se queda con su propio recorte del texto.
 *
 * Antes cada bloque guardaba `fullText.slice(...)`, así que un libro de 3 M de
 * caracteres vivía dos veces en memoria: el texto completo y otra vez repartido
 * en quince mil pedacitos. Acá el texto se corta la PRIMERA vez que alguien lo
 * pide (y queda guardado desde entonces), y en una sesión de lectura solo se
 * piden los bloques que se dibujan o se narran: unas decenas.
 *
 * Para quien lo usa sigue siendo `block.text`, un string común.
 */
export function makeTextBlock(fullText: string, index: number, startChar: number, endChar: number): TextBlock {
  let recorte: string | undefined;
  return {
    index,
    startChar,
    endChar,
    get text(): string {
      if (recorte === undefined) recorte = fullText.slice(startChar, endChar);
      return recorte;
    },
  };
}
