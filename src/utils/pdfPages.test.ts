import { describe, it, expect } from 'vitest';

import { buildPagePlaceholders, findRunningLines, joinPdfPages } from './pdfPages';
import { pageForChar } from './pageMap';

const identity = (raw: string) => raw.trim();

describe('joinPdfPages', () => {
  it('registra un offset por página, también para las vacías', () => {
    const { fullText, pageOffsets } = joinPdfPages(['Uno.', '', 'Tres.'], identity);
    expect(fullText).toBe('Uno.\n\nTres.');
    expect(pageOffsets).toEqual([0, 4, 6]);
  });

  it('cada offset apunta al inicio real del texto de su página', () => {
    const pages = ['Primera página completa.', 'Segunda página completa.', 'Tercera página completa.'];
    const { fullText, pageOffsets } = joinPdfPages(pages, identity);
    pages.forEach((page, index) => {
      expect(fullText.slice(pageOffsets[index], pageOffsets[index] + page.length)).toBe(page);
    });
    expect(pageForChar(pageOffsets[1] + 3, pageOffsets)).toBe(1);
  });

  it('une con espacio el párrafo que sigue en la página siguiente', () => {
    const { fullText, pageOffsets } = joinPdfPages(['El rey miró hacia', 'el norte y calló.'], identity);
    expect(fullText).toBe('El rey miró hacia el norte y calló.');
    expect(fullText.slice(pageOffsets[1])).toBe('el norte y calló.');
  });

  it('mantiene el salto de párrafo cuando la página termina la oración', () => {
    const { fullText } = joinPdfPages(['El rey calló.', 'el norte esperaba.'], identity);
    expect(fullText).toBe('El rey calló.\n\nel norte esperaba.');
  });

  it('une la palabra cortada por el cambio de página', () => {
    const { fullText, pageOffsets } = joinPdfPages(['Llegaron al cas-', 'tillo de noche.'], identity);
    expect(fullText).toBe('Llegaron al castillo de noche.');
    expect(fullText.slice(pageOffsets[1])).toBe('tillo de noche.');
  });

  it('no une si la página siguiente arranca con mayúscula', () => {
    const { fullText } = joinPdfPages(['CAPÍTULO UNO', 'Era de noche.'], identity);
    expect(fullText).toBe('CAPÍTULO UNO\n\nEra de noche.');
  });
});

describe('encabezados y pies repetidos', () => {
  const pages = Array.from({ length: 12 }, (_, i) =>
    `JUEGO DE TRONOS\nTexto propio de la página ${i + 1} que no se repite.\n${i + 1}`,
  );

  it('detecta la línea que se repite arriba de muchas páginas', () => {
    expect(findRunningLines(pages).has('juegodetronos')).toBe(true);
  });

  it('la saca del texto para que la voz no la lea en cada página', () => {
    const { fullText } = joinPdfPages(pages, identity);
    expect(fullText).not.toContain('JUEGO DE TRONOS');
    expect(fullText).toContain('Texto propio de la página 7');
  });

  it('no toca una línea que aparece pocas veces', () => {
    const few = ['PRÓLOGO\nTexto uno.', 'Texto dos sigue.', 'PRÓLOGO\nTexto tres.', 'Texto cuatro.'];
    const { fullText } = joinPdfPages(few, identity);
    expect(fullText).toContain('PRÓLOGO');
  });

  it('no borra esa misma frase cuando aparece en medio de la página', () => {
    const withMiddle = pages.map((page, i) => (i === 3 ? page.replace('Texto propio', 'Leía JUEGO DE TRONOS\nTexto propio') : page));
    const { fullText } = joinPdfPages(withMiddle, identity);
    expect(fullText).toContain('Leía JUEGO DE TRONOS');
  });
});

describe('encabezados con ruido de OCR', () => {
  // El mismo encabezado, leído distinto por el OCR en algunas páginas.
  const variants = ['MEDITACIONES 41', 'MEDITA CIO NES', 'MEDITACIONES i%', 'MEDITACIONES'];
  // El cuerpo cambia en LETRAS de una página a otra (si solo cambiara un número,
  // sería —con razón— tomado por un pie repetido).
  const WORDS = ['alba', 'bruma', 'cima', 'duna', 'eco', 'faro', 'gruta', 'hoz', 'isla', 'jara', 'lago', 'monte', 'nube', 'ola', 'pozo', 'risco'];
  const pages = Array.from({ length: 16 }, (_, i) =>
    `${i < 4 ? variants[i] : `MEDITACIONES ${i + 40}`}\nEl rey miró hacia la ${WORDS[i]} en la página ${i + 1} y siguió`,
  );

  it('saca también las variantes mal leídas', () => {
    const { fullText } = joinPdfPages(pages, identity);
    expect(fullText).not.toMatch(/MEDITA/);
    expect(fullText).toContain('en la página 2');
  });

  it('sin el encabezado de por medio, el párrafo que sigue se une', () => {
    const continued = ['MEDITACIONES 1\nes menester que', 'MEDITA CIO NES\nmultipliquemos los haces.'];
    const padding = Array.from({ length: 10 }, (_, i) => `MEDITACIONES ${i + 3}\nTexto de relleno ${i}.`);
    const { fullText } = joinPdfPages([...continued, ...padding], identity);
    expect(fullText).toContain('es menester que multipliquemos los haces.');
  });

  it('no confunde una primera línea parecida pero distinta', () => {
    const withTitle = pages.map((page, i) => (i === 8 ? `Meditación preliminar\nTexto del capítulo.` : page));
    const { fullText } = joinPdfPages(withTitle, identity);
    expect(fullText).toContain('Meditación preliminar');
  });
});

describe('buildPagePlaceholders (PDF escaneado)', () => {
  it('da a cada página un offset propio para que progreso y marcadores funcionen', () => {
    const { fullText, pageOffsets } = buildPagePlaceholders(3);
    expect(pageOffsets).toHaveLength(3);
    expect(new Set(pageOffsets).size).toBe(3);
    expect(pageForChar(pageOffsets[0], pageOffsets)).toBe(0);
    expect(pageForChar(pageOffsets[2], pageOffsets)).toBe(2);
    expect(fullText.slice(pageOffsets[1])).toMatch(/^Página 2/);
  });
});
