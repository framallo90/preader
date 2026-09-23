import { describe, expect, it } from 'vitest';

import { MAX_QUOTE_CHARS, prepareQuote, quoteFontSize } from './quoteCard';

describe('prepareQuote', () => {
  it('junta los renglones del libro en uno', () => {
    expect(prepareQuote('En un lugar\nde la Mancha,\n  de cuyo nombre')).toBe('En un lugar de la Mancha, de cuyo nombre');
  });

  it('saca las comillas y la raya de diálogo de los bordes', () => {
    expect(prepareQuote('«Ladran, Sancho»')).toBe('Ladran, Sancho');
    expect(prepareQuote('— Ladran, Sancho.')).toBe('Ladran, Sancho.');
  });

  it('una cita larga se corta en una palabra, con puntos suspensivos', () => {
    const larga = 'palabra '.repeat(200);
    const hecha = prepareQuote(larga);
    expect(hecha.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS + 1);
    expect(hecha.endsWith('palabra…')).toBe(true);
  });

  it('una cita corta queda igual', () => {
    expect(prepareQuote('Hola.')).toBe('Hola.');
  });
});

describe('quoteFontSize', () => {
  it('más largo, más chico', () => {
    const tamanios = [10, 150, 300, 600].map((n) => quoteFontSize('a'.repeat(n)));
    expect([...tamanios].sort((a, b) => b - a)).toEqual(tamanios);
    expect(tamanios[0]).toBeGreaterThan(tamanios[3]);
  });
});
