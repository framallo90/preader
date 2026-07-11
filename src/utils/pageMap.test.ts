import { describe, it, expect } from 'vitest';

import { charForPage, pageForChar } from './pageMap';

// Libro típico: tapa e índice sin texto (offsets repetidos en 0),
// después páginas con contenido.
const offsets = [0, 0, 0, 120, 300, 300, 520];
const totalLength = 700;

describe('pageForChar', () => {
  it('el inicio del texto cae en la última página "vacía" del frente (no la tapa)', () => {
    expect(pageForChar(0, offsets)).toBe(2);
  });

  it('mapea offsets a su página exacta', () => {
    expect(pageForChar(150, offsets)).toBe(3);
    expect(pageForChar(300, offsets)).toBe(5);
    expect(pageForChar(699, offsets)).toBe(6);
  });

  it('clampa más allá del final', () => {
    expect(pageForChar(99999, offsets)).toBe(6);
  });
});

describe('charForPage', () => {
  it('devuelve un punto dentro del rango de la página', () => {
    const abs = charForPage(3, offsets, totalLength);
    expect(abs).toBeGreaterThanOrEqual(120);
    expect(abs).toBeLessThan(300);
  });

  it('última página: entre su inicio y el final del texto', () => {
    const abs = charForPage(6, offsets, totalLength);
    expect(abs).toBeGreaterThanOrEqual(520);
    expect(abs).toBeLessThanOrEqual(totalLength);
  });

  it('round-trip: la página del char de una página CON TEXTO es esa página', () => {
    // (la 4 es vacía — offsets[4] === offsets[5] — y no puede hacer round-trip)
    for (const page of [2, 3, 5, 6]) {
      expect(pageForChar(charForPage(page, offsets, totalLength), offsets)).toBe(page);
    }
  });

  it('clampa páginas fuera de rango', () => {
    expect(charForPage(-1, offsets, totalLength)).toBe(charForPage(0, offsets, totalLength));
    expect(charForPage(99, offsets, totalLength)).toBe(charForPage(6, offsets, totalLength));
  });
});
