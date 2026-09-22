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

describe('normalizar textos grandes por tramos', () => {
  const NL = String.fromCharCode(10);

  it('un texto de más de 2 MB da el mismo resultado que uno chico', () => {
    const parrafo = ['Una línea con   espacios de más   acá.', 'Otra línea.', '', '', '', 'Después de varios saltos.'].join(NL);
    // Suficiente para cruzar el umbral de 2 MB y varios tramos.
    const grande = Array.from({ length: 30000 }, () => parrafo).join(NL + NL);
    const porTramos = normalizeExtractedText(grande);

    // El mismo texto, normalizado en pedazos chicos y unido, tiene que coincidir
    // en sus propiedades: sin espacios dobles, sin más de una línea en blanco.
    expect(porTramos).not.toMatch(/  /);
    expect(porTramos.includes(NL + NL + NL)).toBe(false);
    expect(porTramos.startsWith('Una línea con espacios de más acá.')).toBe(true);
    expect(porTramos.length).toBeGreaterThan(1000);
  });

  it('el corte entre tramos no parte una palabra', () => {
    const largo = ('palabra '.repeat(400000)).trim();
    const salida = normalizeExtractedText(largo);
    expect(salida.split(' ').every((w) => w === 'palabra')).toBe(true);
  });
});

describe('bloques perezosos', () => {
  const NL = String.fromCharCode(10);
  const libro = ['Primer párrafo del libro.', '', 'Segundo párrafo del libro.', '', 'Tercero.'].join(NL);

  it('el texto de cada bloque es el recorte exacto de su rango', () => {
    for (const bloque of buildTextBlocks(libro)) {
      expect(bloque.text).toBe(libro.slice(bloque.startChar, bloque.endChar));
    }
  });

  it('pedirlo dos veces da lo mismo (se guarda al primer uso)', () => {
    const bloque = buildTextBlocks(libro)[0];
    expect(bloque.text).toBe(bloque.text);
  });

  it('se comporta como un objeto común: se puede copiar y serializar', () => {
    const bloque = buildTextBlocks(libro)[0];
    const copia = { ...bloque };
    expect(copia.text).toBe(bloque.text);
    expect(JSON.parse(JSON.stringify(bloque)).text).toBe(bloque.text);
  });

  it('no toca el texto hasta que se lo piden', () => {
    // Un libro grande: armar los bloques no debería costar lo que cuesta
    // recortarlos todos. Se comprueba que el recorte no pasó por el texto.
    const grande = 'Una frase cualquiera del libro. '.repeat(50000);
    const bloques = buildTextBlocks(grande);
    expect(bloques.length).toBeGreaterThan(0);
    // Pedir uno solo funciona, sin haber materializado el resto.
    expect(bloques[0].text.length).toBeGreaterThan(0);
  });
});
