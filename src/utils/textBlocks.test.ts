import { describe, it, expect } from 'vitest';

import { buildTextBlocks, normalizeExtractedText } from './textBlocks';

describe('normalizeExtractedText', () => {
  it('une palabras cortadas con guión al final de línea', () => {
    expect(normalizeExtractedText('recor-\ndar')).toBe('recordar');
  });

  it('colapsa 3+ saltos de línea en 2', () => {
    expect(normalizeExtractedText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('colapsa espacios múltiples en uno solo', () => {
    expect(normalizeExtractedText('a     b    c')).toBe('a b c');
  });

  it('deja el tab suelto (lo resuelve cleanPdfTabArtifacts antes en el pipeline)', () => {
    // normalizeExtractedText sólo colapsa runs de 2+; el tab entre palabras
    // ya fue reemplazado por cleanPdfTabArtifacts en el paso anterior.
    expect(normalizeExtractedText('a\tb')).toBe('a\tb');
  });

  it('normaliza CRLF y recorta extremos', () => {
    expect(normalizeExtractedText('  hola\r\nmundo  ')).toBe('hola\nmundo');
  });
});

describe('buildTextBlocks', () => {
  it('devuelve [] con texto vacío o sólo espacios', () => {
    expect(buildTextBlocks('')).toEqual([]);
    expect(buildTextBlocks('    ')).toEqual([]);
  });

  it('indexa los bloques de forma correlativa desde 0', () => {
    const blocks = buildTextBlocks(
      'Párrafo uno con varias palabras.\n\nPárrafo dos, distinto.\n\nPárrafo tres final.',
    );
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.map((b) => b.index)).toEqual(blocks.map((_, i) => i));
  });

  it('INVARIANTE: cada bloque referencia exactamente su tramo en fullText', () => {
    // Es la propiedad de la que depende el resaltado de palabra.
    const full = normalizeExtractedText(
      'Primera oración corta. Segunda oración un poco más larga que la anterior. Tercera y última.',
    );
    const blocks = buildTextBlocks(full);
    for (const b of blocks) {
      expect(b.endChar).toBe(b.startChar + b.text.length);
      expect(full.slice(b.startChar, b.endChar)).toBe(b.text);
    }
  });

  it('los offsets no retroceden y quedan dentro del texto', () => {
    const full = normalizeExtractedText(
      'Uno dos tres cuatro. Cinco seis siete ocho nueve. Diez once doce.\n\nOtro párrafo acá.',
    );
    const blocks = buildTextBlocks(full);
    let prevStart = -1;
    for (const b of blocks) {
      expect(b.startChar).toBeGreaterThan(prevStart - 1);
      expect(b.endChar).toBeLessThanOrEqual(full.length);
      prevStart = b.startChar;
    }
  });
});
