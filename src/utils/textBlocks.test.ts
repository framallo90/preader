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

// Texto como sale de un PDF o de un TXT con renglones cortados: saltos de línea
// en medio de los párrafos. El test de invariante de arriba usa párrafos de una
// sola línea y por eso no veía el bug: con saltos de línea, 1 de cada 4 bloques
// quedaba con offsets que apuntaban a otro lugar del texto.
describe('buildTextBlocks con renglones cortados', () => {
  const NL = String.fromCharCode(10);
  const paragraph = (i: number) =>
    [
      `El viajero llegó al pueblo numero ${i} cuando caía la tarde y las primeras`,
      'luces se encendían en las ventanas. Nadie lo esperaba, y sin embargo todos',
      ' parecían saber quién era. Caminó por la calle principal con paso tranquilo,',
      'mirando los balcones y las puertas entornadas. Se sentó en un banco.',
    ].join(NL);
  const text = Array.from({ length: 30 }, (_, i) => paragraph(i + 1)).join(NL + NL);
  const blocks = buildTextBlocks(text);

  it('cada bloque es EXACTAMENTE su rango del texto original', () => {
    expect(blocks.length).toBeGreaterThan(30);
    for (const block of blocks) {
      expect(text.slice(block.startChar, block.endChar)).toBe(block.text);
    }
  });

  it('los bloques van en orden y entre uno y otro solo queda espacio en blanco', () => {
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].startChar).toBeGreaterThanOrEqual(blocks[i - 1].endChar);
      expect(text.slice(blocks[i - 1].endChar, blocks[i].startChar).trim()).toBe('');
    }
    expect(blocks[0].startChar).toBe(0);
    expect(blocks[blocks.length - 1].endChar).toBe(text.length);
  });

  it('ningún bloque cruza de un párrafo a otro', () => {
    for (const block of blocks) {
      expect(block.text.includes(NL + NL)).toBe(false);
    }
  });
});

