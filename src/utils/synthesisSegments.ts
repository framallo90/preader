import { Span, paragraphSpans, spanLength, splitSpan } from './textSpans';

// CLAVE para que suene natural: los tramos se cortan SÓLO en fin de oración
// (. ! ? …), NUNCA en medio. Son cortos (~30 s de audio) porque la voz la
// sintetiza el motor del teléfono: así el primer audio sale en 1-3 s. El corte
// entre tramos cae siempre en fin de oración, donde una pausa es natural, y el
// prefetch de los siguientes mantiene la continuidad.
const DEFAULT_MAX_CHUNK_CHARS = 500;
// Sólo una oración descomunal (rarísimo) se subdivide, y en pausas naturales (, ; :).
const HARD_SENTENCE_LIMIT = 2200;
// Tope real del motor de voz de Android (TextToSpeech.getMaxSpeechInputLength()
// devuelve 4000): un tramo más largo lo rechaza y la voz se corta ahí PARA
// SIEMPRE, porque cada reintento arma el mismo tramo. Pasa con texto de OCR sin
// puntuación (índices onomásticos, tablas aplanadas). Se deja margen.
const ENGINE_TEXT_LIMIT = 3500;

/**
 * Una oración dentro de un tramo, como RANGO. No guarda el texto: guardarlo
 * duplicaba el libro entero en memoria (un tomo de 3 M de caracteres dejaba
 * ~6 MB repartidos en 40.000 strings) para un dato que nadie lee — la síntesis
 * corta `fullText` por `startChar`/`endChar` cuando le toca a cada tramo.
 */
export type SynthesisSegment = {
  index: number;
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

/**
 * Último recurso cuando no hay dónde cortar con sentido: parte en el último
 * espacio antes del tope (y si no hay ni un espacio, en el tope justo). Feo,
 * pero es esto o que el motor de voz rechace el tramo y la voz no siga.
 */
function splitAtWhitespace(text: string, span: Span, limit: number): Span[] {
  if (spanLength(span) <= limit) return [span];
  const pieces: Span[] = [];
  let start = span.start;
  while (span.end - start > limit) {
    const hardEnd = start + limit;
    let cut = -1;
    for (let i = hardEnd; i > start + Math.floor(limit / 2); i--) {
      if (/\s/.test(text[i])) { cut = i; break; }
    }
    const end = cut > start ? cut : hardEnd;
    pieces.push({ start, end });
    start = end;
  }
  if (start < span.end) pieces.push({ start, end: span.end });
  return pieces;
}

/** Ningún tramo puede superar lo que el motor de voz acepta. */
function enforceEngineLimit(text: string, spans: Span[]): Span[] {
  let needsSplit = false;
  for (const span of spans) {
    if (spanLength(span) > ENGINE_TEXT_LIMIT) { needsSplit = true; break; }
  }
  if (!needsSplit) return spans;
  return spans.flatMap((span) => splitAtWhitespace(text, span, ENGINE_TEXT_LIMIT));
}

/**
 * Oraciones de todo el libro, como rangos: lo único costoso (recorrer el texto
 * entero) se hace UNA vez por documento; armar tramos desde cualquier punto es
 * después un recorrido de esta lista.
 */
export function buildSentenceSpans(fullText: string): Span[] {
  // Siempre a nivel oración (aunque el párrafo sea corto): el primer tramo tiene
  // que poder ser de una o dos oraciones. Empaquetar después vuelve a juntarlas.
  return enforceEngineLimit(
    fullText,
    paragraphSpans(fullText).flatMap((paragraph) =>
      splitSpan(fullText, paragraph, SENTENCE_BOUNDARY).flatMap((sentence) =>
        spanLength(sentence) > HARD_SENTENCE_LIMIT
          ? packSpans(splitSpan(fullText, sentence, CLAUSE_BOUNDARY), HARD_SENTENCE_LIMIT)
          : [sentence],
      ),
    ),
  );
}

// ── Tramos anclados al punto de arranque ─────────────────────────────────────
//
// El primer tramo desde donde se empieza a escuchar es CORTO: el motor del
// teléfono sintetiza a unas pocas veces la velocidad real, así que 500 caracteres
// (~35 s de audio) eran varios segundos de espera antes de la primera palabra. Con
// ~160 caracteres suena enseguida; los siguientes crecen y el prefetch mantiene la
// continuidad. Delante del ancla se usan tramos normales, para poder retroceder.
export const ANCHORED_CHUNK_SCHEDULE = [160, 320];

function packWithSchedule(spans: Span[], schedule: number[], maxChars: number): Span[] {
  const packed: Span[] = [];
  let current: Span | null = null;
  let limit = schedule[0] ?? maxChars;
  for (const span of spans) {
    if (current && span.end - current.start <= limit) {
      current = { start: current.start, end: span.end };
    } else {
      if (current) packed.push(current);
      current = span;
      limit = schedule[packed.length] ?? maxChars;
    }
  }
  if (current) packed.push(current);
  return packed;
}

/**
 * Tramos de todo el libro con la grilla anclada en `anchorChar`: delante del
 * ancla, tramos de `maxChars`; desde la oración que contiene el ancla, primero
 * los tamaños de `schedule` y después `maxChars`. Determinista: arrancar dos
 * veces del mismo punto da los mismos tramos (y reutiliza el audio cacheado).
 */
export function buildAnchoredChunks(
  fullText: string,
  sentences: Span[],
  anchorChar: number,
  maxChars = DEFAULT_MAX_CHUNK_CHARS,
  schedule = ANCHORED_CHUNK_SCHEDULE,
): SynthesisChunk[] {
  if (sentences.length === 0) return [];
  let anchorIndex = sentences.findIndex((sentence) => anchorChar < sentence.end);
  if (anchorIndex < 0) anchorIndex = sentences.length - 1;

  const before = packSpans(sentences.slice(0, anchorIndex), maxChars);
  const after = packWithSchedule(sentences.slice(anchorIndex), schedule, maxChars);

  let sentenceCursor = 0;
  return [...before, ...after].map((span, index) => {
    const segments: SynthesisSegment[] = [];
    while (sentenceCursor < sentences.length && sentences[sentenceCursor].end <= span.end) {
      const sentence = sentences[sentenceCursor];
      segments.push({ index: segments.length, startChar: sentence.start, endChar: sentence.end });
      sentenceCursor += 1;
    }
    return { index, startChar: span.start, endChar: span.end, segments };
  });
}

/** Índice del tramo que contiene el offset (búsqueda binaria; -1 si no hay tramos). */
export function chunkIndexForChar(chunks: SynthesisChunk[], absoluteChar: number): number {
  if (chunks.length === 0) return -1;
  let low = 0;
  let high = chunks.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (absoluteChar <= chunks[mid].endChar) high = mid;
    else low = mid + 1;
  }
  return low;
}
