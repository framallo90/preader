import { describe, it, expect } from 'vitest';

import { buildSynthesisChunks, buildSynthesisSegments } from './synthesisSegments';

// 8 párrafos cortos → buildSynthesisSegments agrupa de a 5 → al menos 2 segmentos.
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
