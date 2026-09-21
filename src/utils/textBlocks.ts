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
    const splitPoint = findSplitPoint(fullText.slice(remaining.start, remaining.end), HARD_BLOCK_LENGTH);
    const part = trimSpan(fullText, remaining.start, remaining.start + splitPoint);
    if (part) parts.push(part);
    remaining = trimSpan(fullText, remaining.start + splitPoint, remaining.end);
  }

  if (remaining) parts.push(remaining);
  return parts;
}

export function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(HYPHENATED_LINE_BREAK_PATTERN, '$1$2')
    .replace(/\u0000/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  if (!fullText.trim()) {
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

  return blockSpans.map((span, index) => ({
    index,
    text: fullText.slice(span.start, span.end),
    startChar: span.start,
    endChar: span.end,
  }));
}
