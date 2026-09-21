import { describe, it, expect } from 'vitest';

import { buildSynthesisChunks, buildSynthesisSegments } from './synthesisSegments';

// 8 párrafos cortos → buildSynthesisSegments agrupa de a varios → al menos 2 segmentos.
const full = Array.from({ length: 8 }, (_, i) => `Parrafo numero ${i + 1} con algo de texto para el tramo.`).join('\n\n');

describe('buildSynthesisSegments', () => {
  const segments = buildSynthesisSegments(full);

  it('cubre el texto con offsets consistentes', () => {
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      expect(s.endChar).toBe(s.startChar + s.text.length);
      expect(s.startChar).toBeGreaterThanOrEqual(0);
      expect(s.endChar).toBeLessThanOrEqual(full.length);
    }
    expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
  });
});

describe('buildSynthesisChunks', () => {
  const segments = buildSynthesisSegments(full);

  it('con maxSegments=1 hay un chunk por segmento', () => {
    const chunks = buildSynthesisChunks(full, 5000, 1);
    expect(chunks.length).toBe(segments.length);
    for (const c of chunks) {
      expect(c.segments.length).toBe(1);
      expect(c.startChar).toBe(c.segments[0].startChar);
      expect(c.endChar).toBe(c.segments[c.segments.length - 1].endChar);
    }
  });

  it('respeta el tope de segmentos por chunk', () => {
    const chunks = buildSynthesisChunks(full, 100000, 3);
    for (const c of chunks) {
      expect(c.segments.length).toBeLessThanOrEqual(3);
    }
  });

  it('cada tramo TERMINA en fin de oración (nunca corta en medio)', () => {
    // Oraciones largas con comas → antes se partían por palabras a mitad de idea.
    const sentence =
      'Este es un fragmento largo con varias comas, aclaraciones, subordinadas y detalles que estiran la oración lo suficiente para forzar el corte en tramos';
    const prose = Array.from({ length: 16 }, (_, i) => `${sentence} numero ${i + 1}.`).join(' ');
    const chunks = buildSynthesisChunks(prose);
    expect(chunks.length).toBeGreaterThan(1);
    // Todos menos el último deben cerrar en . ! ? … (posible comilla/paréntesis).
    for (const c of chunks.slice(0, -1)) {
      const text = c.segments.map((s) => s.text).join(' ').trim();
      expect(text).toMatch(/[.!?…]["'»”)\]]*$/);
    }
  });
});

// Texto como sale de un PDF: líneas cortadas con un salto de línea (a veces
// seguido de espacio) en medio de las oraciones. La versión anterior reconstruía
// el texto con espacios y lo buscaba con indexOf: no lo encontraba, los offsets
// se corrían y los tramos terminaban cortando palabras ("plenitu" | "d. Un alma…").
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
  const chunks = buildSynthesisChunks(prose);

  it('cada segmento es exactamente el texto original de su rango', () => {
    for (const segment of buildSynthesisSegments(prose)) {
      expect(prose.slice(segment.startChar, segment.endChar)).toBe(segment.text);
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
