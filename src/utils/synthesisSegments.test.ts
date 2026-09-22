import { describe, it, expect } from 'vitest';

import {
  ANCHORED_CHUNK_SCHEDULE,
  buildAnchoredChunks,
  buildSentenceSpans,
  chunkIndexForChar,
} from './synthesisSegments';

/** Los tramos que arma la app: oraciones del libro + grilla anclada en `desde`. */
function tramos(texto: string, desde = 0) {
  return buildAnchoredChunks(texto, buildSentenceSpans(texto), desde);
}

// Texto real de un PDF: los renglones vienen cortados con saltos de línea (y a
// veces con un espacio al principio) en medio de las oraciones. La versión
// anterior reconstruía el texto con espacios y lo buscaba con indexOf: no lo
// encontraba, los offsets se corrían y los tramos terminaban cortando palabras
// ("plenitu" | "d. Un alma…").
describe('offsets exactos sobre texto con saltos de línea', () => {
  const NL = String.fromCharCode(10);
  const line = (i: number) =>
    [
      'Hay dentro de toda cosa la indicación',
      ` de una posible plenitud numero ${i}. Un alma abierta`,
      'y noble sentirá la ambición de perfeccionarla, de auxiliarla,',
      ' para que logre esa su plenitud.',
    ].join(NL);
  const prose = Array.from({ length: 40 }, (_, i) => line(i + 1)).join(NL);
  const chunks = tramos(prose);

  it('las oraciones son rangos exactos del texto original', () => {
    const oraciones = buildSentenceSpans(prose);
    expect(oraciones.length).toBeGreaterThan(3);
    for (const oracion of oraciones) {
      expect(oracion.end).toBeGreaterThan(oracion.start);
      expect(prose.slice(oracion.start, oracion.end).length).toBe(oracion.end - oracion.start);
    }
  });

  it('ningún tramo empieza ni termina a mitad de palabra', () => {
    expect(chunks.length).toBeGreaterThan(3);
    const isLetter = (char: string | undefined) => Boolean(char && /\p{L}/u.test(char));
    for (const chunk of chunks) {
      expect(isLetter(prose[chunk.startChar - 1]) && isLetter(prose[chunk.startChar])).toBe(false);
      expect(isLetter(prose[chunk.endChar - 1]) && isLetter(prose[chunk.endChar])).toBe(false);
    }
  });

  it('todos los tramos cierran en fin de oración', () => {
    for (const chunk of chunks.slice(0, -1)) {
      expect(prose.slice(chunk.startChar, chunk.endChar)).toMatch(/[.!?…]["'»”)\]]*$/);
    }
  });

  it('los tramos van en orden, sin solaparse, y cubren todo el texto', () => {
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startChar).toBeGreaterThanOrEqual(chunks[i - 1].endChar);
      // Entre tramo y tramo solo puede quedar espacio en blanco.
      expect(prose.slice(chunks[i - 1].endChar, chunks[i].startChar).trim()).toBe('');
    }
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[chunks.length - 1].endChar).toBe(prose.length);
  });
});

describe('tramos anclados (arranque rápido de la voz)', () => {
  // Un libro de 60 oraciones de ~90 caracteres, en párrafos de 3.
  const sentence = (i: number) => `Esta es la oración número ${i + 1}, con palabras suficientes para medir el tramo.`;
  const book = Array.from({ length: 20 }, (_, p) =>
    [0, 1, 2].map((k) => sentence(p * 3 + k)).join(' '),
  ).join('\n\n');
  const sentences = buildSentenceSpans(book);

  it('las oraciones cubren el texto en orden y sin solaparse', () => {
    expect(sentences.length).toBe(60);
    for (let i = 1; i < sentences.length; i++) expect(sentences[i].start).toBeGreaterThanOrEqual(sentences[i - 1].end);
    expect(book.slice(sentences[0].start, sentences[0].end)).toBe(sentence(0));
  });

  it('desde el ancla, el primer tramo es corto y los siguientes crecen', () => {
    const anchor = sentences[30].start + 10; // a mitad de la oración 31
    const chunks = buildAnchoredChunks(book, sentences, anchor);
    const at = chunkIndexForChar(chunks, anchor);
    expect(chunks[at].startChar).toBe(sentences[30].start); // arranca en el inicio exacto de la oración
    expect(chunks[at].endChar - chunks[at].startChar).toBeLessThanOrEqual(ANCHORED_CHUNK_SCHEDULE[0]);
    expect(chunks[at + 1].endChar - chunks[at + 1].startChar).toBeLessThanOrEqual(ANCHORED_CHUNK_SCHEDULE[1]);
    expect(chunks[at + 2].endChar - chunks[at + 2].startChar).toBeGreaterThan(ANCHORED_CHUNK_SCHEDULE[1]);
  });

  it('cubre todo el libro, también delante del ancla, sin huecos de texto', () => {
    const chunks = buildAnchoredChunks(book, sentences, sentences[30].start);
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[chunks.length - 1].endChar).toBe(book.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].startChar).toBeGreaterThanOrEqual(chunks[i - 1].endChar);
      expect(book.slice(chunks[i - 1].endChar, chunks[i].startChar).trim()).toBe('');
    }
    expect(chunks.flatMap((c) => c.segments).length).toBe(sentences.length);
  });

  it('arrancar dos veces del mismo punto da la misma grilla (reutiliza el audio)', () => {
    const a = buildAnchoredChunks(book, sentences, 1234);
    const b = buildAnchoredChunks(book, sentences, 1234);
    expect(a.map((c) => [c.startChar, c.endChar])).toEqual(b.map((c) => [c.startChar, c.endChar]));
  });

  it('un ancla fuera de rango cae en el último tramo', () => {
    const chunks = buildAnchoredChunks(book, sentences, book.length + 500);
    expect(chunkIndexForChar(chunks, book.length + 500)).toBe(chunks.length - 1);
    expect(chunkIndexForChar(chunks, 0)).toBe(0);
    expect(chunkIndexForChar([], 5)).toBe(-1);
  });
});

describe('tope del motor de voz', () => {
  // Texto de OCR sin puntuación: no hay fin de oración NI pausa donde cortar.
  const sinPuntuacion = Array.from({ length: 900 }, (_, i) => `palabra${i}`).join(' ');

  it('ninguna oración supera lo que acepta el motor', () => {
    const spans = buildSentenceSpans(sinPuntuacion);
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(3500);
  });

  it('los tramos anclados tampoco lo superan y cubren todo el texto', () => {
    const spans = buildSentenceSpans(sinPuntuacion);
    const chunks = buildAnchoredChunks(sinPuntuacion, spans, 0);
    for (const chunk of chunks) expect(chunk.endChar - chunk.startChar).toBeLessThanOrEqual(3500);
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[chunks.length - 1].endChar).toBe(sinPuntuacion.length);
  });

  it('corta en espacios, no en medio de una palabra', () => {
    const spans = buildSentenceSpans(sinPuntuacion);
    for (const span of spans.slice(1)) {
      // Ninguna palabra queda partida: el corte cae sobre un espacio (antes o en
      // el propio límite, según de qué lado quede el blanco).
      const antes = sinPuntuacion[span.start - 1] ?? ' ';
      const enElCorte = sinPuntuacion[span.start] ?? ' ';
      expect(/\s/.test(antes) || /\s/.test(enElCorte)).toBe(true);
    }
  });

  it('un texto normal no se toca', () => {
    const normal = 'Una oración corta. Otra oración corta. Y una tercera.';
    const spans = buildSentenceSpans(normal);
    expect(spans.map((s) => normal.slice(s.start, s.end).trim())).toEqual([
      'Una oración corta.',
      'Otra oración corta.',
      'Y una tercera.',
    ]);
  });
});
