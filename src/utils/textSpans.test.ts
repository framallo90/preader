import { describe, expect, it } from 'vitest';

import { isWhitespaceCode, paragraphSpans, sentenceSpanAround, spanLength, splitSpan, trimSpan } from './textSpans';

const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

/** El texto de un rango, para leer los tests sin contar posiciones a mano. */
function slice(text: string, span: { start: number; end: number }): string {
  return text.slice(span.start, span.end);
}

describe('isWhitespaceCode', () => {
  it('reconoce los blancos de siempre', () => {
    for (const char of [' ', TAB, NL, '\r']) {
      expect(isWhitespaceCode(char.charCodeAt(0))).toBe(true);
    }
  });

  it('reconoce los blancos raros que trae un PDF', () => {
    // Espacio duro, espacio fino, separador de línea, marca de orden de bytes.
    for (const code of [0x00a0, 0x2009, 0x2028, 0x202f, 0x3000, 0xfeff]) {
      expect(isWhitespaceCode(code)).toBe(true);
    }
  });

  it('una letra no es un blanco', () => {
    for (const char of ['a', 'Ñ', '1', '.', '—']) {
      expect(isWhitespaceCode(char.charCodeAt(0))).toBe(false);
    }
  });
});

describe('trimSpan', () => {
  it('saca los blancos de las dos puntas', () => {
    const text = '   hola   ';
    expect(slice(text, trimSpan(text, 0, text.length)!)).toBe('hola');
  });

  it('un rango de puro blanco no existe', () => {
    expect(trimSpan('     ', 0, 5)).toBeNull();
    expect(trimSpan(NL + NL + ' ', 0, 3)).toBeNull();
  });

  it('un rango vacío no existe', () => {
    expect(trimSpan('hola', 2, 2)).toBeNull();
  });

  it('no toca los blancos de adentro', () => {
    const text = 'a   b';
    expect(slice(text, trimSpan(text, 0, text.length)!)).toBe('a   b');
  });

  it('respeta los límites que le dan, no el texto entero', () => {
    const text = 'hola mundo querido';
    expect(slice(text, trimSpan(text, 4, 11)!)).toBe('mundo');
  });
});

describe('paragraphSpans', () => {
  it('parte donde hay una línea en blanco', () => {
    const text = ['Primero.', '', 'Segundo.', '', 'Tercero.'].join(NL);
    expect(paragraphSpans(text).map((s) => slice(text, s))).toEqual(['Primero.', 'Segundo.', 'Tercero.']);
  });

  it('varias líneas en blanco seguidas son un solo corte', () => {
    const text = ['Primero.', '', '', '', 'Segundo.'].join(NL);
    expect(paragraphSpans(text).map((s) => slice(text, s))).toEqual(['Primero.', 'Segundo.']);
  });

  it('un renglón suelto adentro del párrafo NO lo parte', () => {
    const text = ['Una frase', 'que sigue en el renglón de abajo.', '', 'Otro párrafo.'].join(NL);
    expect(paragraphSpans(text).map((s) => slice(text, s))).toEqual([
      'Una frase' + NL + 'que sigue en el renglón de abajo.',
      'Otro párrafo.',
    ]);
  });

  it('texto vacío o de puro blanco no da párrafos', () => {
    expect(paragraphSpans('')).toEqual([]);
    expect(paragraphSpans('   ' + NL + NL + '  ')).toEqual([]);
  });

  it('un solo párrafo sigue siendo un párrafo', () => {
    const text = 'Una sola cosa.';
    expect(paragraphSpans(text).map((s) => slice(text, s))).toEqual(['Una sola cosa.']);
  });

  it('los rangos van en orden, sin solaparse y sin salirse del texto', () => {
    const text = ['Uno.', '', 'Dos.', '', '', 'Tres.', '', 'Cuatro.'].join(NL);
    const spans = paragraphSpans(text);
    expect(spans.length).toBeGreaterThan(1);
    for (let i = 0; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(0);
      expect(spans[i].end).toBeLessThanOrEqual(text.length);
      expect(spans[i].end).toBeGreaterThan(spans[i].start);
      if (i > 0) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
  });

  it('llamarlo dos veces da lo mismo (el regex global no se ensucia)', () => {
    const text = ['Uno.', '', 'Dos.', '', 'Tres.'].join(NL);
    expect(paragraphSpans(text)).toEqual(paragraphSpans(text));
  });
});

describe('splitSpan', () => {
  const SENTENCE = /[.!?…]+["'»”’)\]]*(?=\s)/g;

  it('corta en fin de oración y deja el punto del lado izquierdo', () => {
    const text = 'Uno. Dos. Tres.';
    const parts = splitSpan(text, { start: 0, end: text.length }, SENTENCE);
    expect(parts.map((s) => slice(text, s))).toEqual(['Uno.', 'Dos.', 'Tres.']);
  });

  it('sin dónde cortar devuelve el rango entero', () => {
    const text = 'Una frase sin final';
    const parts = splitSpan(text, { start: 0, end: text.length }, SENTENCE);
    expect(parts.map((s) => slice(text, s))).toEqual(['Una frase sin final']);
  });

  it('las partes cubren el rango sin perder nada más que blancos', () => {
    const text = 'Primera oración. Segunda oración. Y la última.';
    const parts = splitSpan(text, { start: 0, end: text.length }, SENTENCE);
    const unido = parts.map((s) => slice(text, s)).join(' ');
    expect(unido).toBe(text);
  });

  it('trabaja dentro de los límites que le dan', () => {
    const text = 'Antes. Adentro uno. Adentro dos. Después.';
    const from = text.indexOf('Adentro uno');
    const to = text.indexOf('Después.');
    const parts = splitSpan(text, { start: from, end: to }, SENTENCE);
    expect(parts.map((s) => slice(text, s))).toEqual(['Adentro uno.', 'Adentro dos.']);
  });

  it('un rango de puro blanco no da partes', () => {
    const text = '   ' + NL + '  ';
    expect(splitSpan(text, { start: 0, end: text.length }, SENTENCE)).toEqual([]);
  });
});

describe('spanLength', () => {
  it('es la distancia entre las puntas', () => {
    expect(spanLength({ start: 3, end: 10 })).toBe(7);
    expect(spanLength({ start: 5, end: 5 })).toBe(0);
  });
});

describe('sentenceSpanAround', () => {
  const texto = 'Primera oración. El viajero llegó al pueblo cuando caía la tarde. Última acá.';

  it('devuelve la oración que contiene al índice', () => {
    const at = texto.indexOf('caía');
    const span = sentenceSpanAround(texto, at);
    expect(texto.slice(span.start, span.end)).toBe('El viajero llegó al pueblo cuando caía la tarde.');
  });

  it('en la primera oración arranca en cero', () => {
    const span = sentenceSpanAround(texto, 2);
    expect(texto.slice(span.start, span.end)).toBe('Primera oración.');
  });

  it('en la última llega hasta el final', () => {
    const span = sentenceSpanAround(texto, texto.length - 3);
    expect(texto.slice(span.start, span.end)).toBe('Última acá.');
  });

  it('corta en renglón en blanco aunque no haya punto', () => {
    const suelto = 'UN TITULO SIN PUNTO\n\nY el párrafo que sigue.';
    const span = sentenceSpanAround(suelto, 3);
    expect(suelto.slice(span.start, span.end)).toBe('UN TITULO SIN PUNTO');
  });

  it('recorta una "oración" larguísima en vez de devolver media página', () => {
    const largo = `${'palabra '.repeat(400)}fin.`;
    const span = sentenceSpanAround(largo, 2000);
    expect(span.end - span.start).toBeLessThanOrEqual(600);
    expect(span.end).toBeGreaterThan(span.start);
  });

  it('no se cae con texto vacío ni con índices fuera de rango', () => {
    expect(sentenceSpanAround('', 5)).toEqual({ start: 0, end: 0 });
    expect(sentenceSpanAround(texto, -10).end).toBeGreaterThan(0);
    expect(sentenceSpanAround(texto, 99999).end).toBe(texto.length);
  });
});
