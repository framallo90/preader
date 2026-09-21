const DEFAULT_MAX_SEGMENT_CHARS = 450;
const DEFAULT_MAX_PARAGRAPHS = 3;
// CLAVE para que suene natural: los tramos se cortan SÓLO en fin de oración
// (. ! ? …), NUNCA en medio. Son cortos (~30 s de audio) porque la voz la
// sintetiza el motor del teléfono: así el primer audio sale en 1-3 s. El corte
// entre tramos cae siempre en fin de oración, donde una pausa es natural, y el
// prefetch de los siguientes mantiene la continuidad.
const DEFAULT_MAX_CHUNK_CHARS = 500;
const DEFAULT_MAX_CHUNK_SEGMENTS = 2;
// Sólo una oración descomunal (rarísimo) se subdivide, y en pausas naturales (, ; :).
const HARD_SENTENCE_LIMIT = 2200;

export type SynthesisSegment = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export type SynthesisChunk = {
  index: number;
  startChar: number;
  endChar: number;
  segments: SynthesisSegment[];
};

/**
 * Todo el troceo trabaja con RANGOS sobre el texto original: nunca se arma un
 * string nuevo para después buscarlo. La versión anterior unía oraciones con un
 * espacio y las ubicaba con indexOf; como el original tiene saltos de línea, no
 * las encontraba, caía a un offset aproximado y el error se acumulaba hasta
 * cortar tramos A MITAD DE PALABRA ("plenitu" | "d. Un alma…").
 */
type Span = { start: number; end: number };

const spanLength = (span: Span) => span.end - span.start;

/** Rango sin los espacios de las puntas. */
function trimSpan(text: string, start: number, end: number): Span | null {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return to > from ? { start: from, end: to } : null;
}

/** Parte un rango en los puntos donde `boundary` matchea (el match queda a la izquierda). */
function splitSpan(text: string, span: Span, boundary: RegExp): Span[] {
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

// Fin de oración: puntuación final, comillas/paréntesis de cierre, y después espacio.
const SENTENCE_BOUNDARY = /[.!?…]+["'»”’)\]]*(?=\s)/g;
// Pausas naturales dentro de una oración descomunal.
const CLAUSE_BOUNDARY = /[,;:]+(?=\s)/g;

/** Agrupa rangos contiguos en piezas de hasta maxChars (medido de punta a punta). */
function packSpans(spans: Span[], maxChars: number): Span[] {
  const packed: Span[] = [];
  let current: Span | null = null;
  for (const span of spans) {
    if (current && span.end - current.start <= maxChars) {
      current = { start: current.start, end: span.end };
    } else {
      if (current) packed.push(current);
      current = span;
    }
  }
  if (current) packed.push(current);
  return packed;
}

function splitLongParagraph(text: string, paragraph: Span, maxChars: number): Span[] {
  if (spanLength(paragraph) <= maxChars) return [paragraph];

  // Corta SÓLO en fin de oración (. ! ? …), NUNCA en ; : , ni en medio de palabra.
  const sentences = splitSpan(text, paragraph, SENTENCE_BOUNDARY).flatMap((sentence) =>
    // Cada oración se mantiene ENTERA; sólo una descomunal se subdivide.
    spanLength(sentence) > HARD_SENTENCE_LIMIT
      ? packSpans(splitSpan(text, sentence, CLAUSE_BOUNDARY), HARD_SENTENCE_LIMIT)
      : [sentence],
  );

  return packSpans(sentences, maxChars);
}

function buildSegmentSpans(fullText: string, maxChars: number, maxParagraphs: number): Span[] {
  const whole = trimSpan(fullText, 0, fullText.length);
  if (!whole) return [];

  const pieces = splitSpan(fullText, whole, /\n{2,}/g).flatMap((paragraph) =>
    splitLongParagraph(fullText, paragraph, maxChars),
  );

  const segments: Span[] = [];
  let current: Span | null = null;
  let paragraphCount = 0;
  for (const piece of pieces) {
    if (current && piece.end - current.start <= maxChars && paragraphCount < maxParagraphs) {
      current = { start: current.start, end: piece.end };
      paragraphCount += 1;
    } else {
      if (current) segments.push(current);
      current = piece;
      paragraphCount = 1;
    }
  }
  if (current) segments.push(current);
  return segments;
}

export function buildSynthesisSegments(
  fullText: string,
  maxChars = DEFAULT_MAX_SEGMENT_CHARS,
  maxParagraphs = DEFAULT_MAX_PARAGRAPHS,
): SynthesisSegment[] {
  return buildSegmentSpans(fullText, maxChars, maxParagraphs).map((span, index) => ({
    index,
    text: fullText.slice(span.start, span.end),
    startChar: span.start,
    endChar: span.end,
  }));
}

export function buildSynthesisChunks(
  fullText: string,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
  maxChunkSegments = DEFAULT_MAX_CHUNK_SEGMENTS,
) {
  const segments = buildSynthesisSegments(fullText);
  const chunks: SynthesisChunk[] = [];
  let currentSegments: SynthesisSegment[] = [];

  const flushChunk = () => {
    if (currentSegments.length === 0) {
      return;
    }

    chunks.push({
      index: chunks.length,
      startChar: currentSegments[0].startChar,
      endChar: currentSegments[currentSegments.length - 1].endChar,
      segments: currentSegments,
    });
    currentSegments = [];
  };

  segments.forEach((segment) => {
    const currentStart = currentSegments[0]?.startChar ?? segment.startChar;
    const candidateEnd = segment.endChar;
    const candidateChars = candidateEnd - currentStart;
    const candidateSegmentCount = currentSegments.length + 1;

    if (
      currentSegments.length > 0 &&
      (candidateChars > maxChunkChars || candidateSegmentCount > maxChunkSegments)
    ) {
      flushChunk();
    }

    currentSegments.push(segment);
  });

  flushChunk();

  return chunks;
}
