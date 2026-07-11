const DEFAULT_MAX_SEGMENT_CHARS = 1200;
const DEFAULT_MAX_PARAGRAPHS = 5;
// CLAVE para que suene natural: los tramos se cortan SÓLO en fin de oración
// (. ! ? …), NUNCA en medio. Un tamaño moderado da pocos cortes (fluido) y un
// primer audio ágil; el prefetch del siguiente mantiene la continuidad.
const DEFAULT_MAX_CHUNK_CHARS = 1500;
const DEFAULT_MAX_CHUNK_SEGMENTS = 4;
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

function splitLongSentence(sentence: string, maxChars: number) {
  // Sólo se usa para una oración DESCOMUNAL: parte en pausas naturales
  // (coma, punto y coma, dos puntos), no en medio de una palabra o idea.
  const clauses = sentence.match(/[^,;:]+[,;:]*\s*/g) ?? [sentence];
  const parts: string[] = [];
  let current = '';

  for (const clause of clauses) {
    const candidate = current + clause;
    if (!current || candidate.length <= maxChars) {
      current = candidate;
    } else {
      parts.push(current.trim());
      current = clause;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length > 0 ? parts : [sentence.trim()];
}

function splitLongParagraph(paragraph: string, maxChars: number) {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  // Corta SÓLO en fin de oración (. ! ? …), NUNCA en ; : , ni en medio de palabra.
  const sentences = paragraph
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return paragraph.length > HARD_SENTENCE_LIMIT
      ? splitLongSentence(paragraph, HARD_SENTENCE_LIMIT)
      : [paragraph];
  }

  const parts: string[] = [];
  let current = '';

  sentences.forEach((sentence) => {
    // Cada oración se mantiene ENTERA; sólo una descomunal se subdivide.
    const sentenceParts =
      sentence.length > HARD_SENTENCE_LIMIT
        ? splitLongSentence(sentence, HARD_SENTENCE_LIMIT)
        : [sentence];

    sentenceParts.forEach((part) => {
      const candidate = current ? `${current} ${part}` : part;

      if (!current || candidate.length <= maxChars) {
        current = candidate;
        return;
      }

      parts.push(current.trim());
      current = part;
    });
  });

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function buildRawSegments(
  fullText: string,
  maxChars = DEFAULT_MAX_SEGMENT_CHARS,
  maxParagraphs = DEFAULT_MAX_PARAGRAPHS,
) {
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxChars));

  const segments: string[] = [];
  let current = '';
  let paragraphCount = 0;

  paragraphs.forEach((paragraph) => {
    const separator = current ? '\n\n' : '';
    const candidate = `${current}${separator}${paragraph}`;

    if (candidate.length <= maxChars && paragraphCount < maxParagraphs) {
      current = candidate;
      paragraphCount += 1;
      return;
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    current = paragraph;
    paragraphCount = 1;
  });

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments.length > 0 ? segments : [fullText.trim()].filter(Boolean);
}

export function buildSynthesisSegments(
  fullText: string,
  maxChars = DEFAULT_MAX_SEGMENT_CHARS,
  maxParagraphs = DEFAULT_MAX_PARAGRAPHS,
): SynthesisSegment[] {
  const rawSegments = buildRawSegments(fullText, maxChars, maxParagraphs);
  let cursor = 0;

  return rawSegments.map((text, index) => {
    const startChar = fullText.indexOf(text, cursor);
    const safeStartChar = startChar >= 0 ? startChar : cursor;
    const endChar = safeStartChar + text.length;

    cursor = endChar;

    return {
      index,
      text,
      startChar: safeStartChar,
      endChar,
    };
  });
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
