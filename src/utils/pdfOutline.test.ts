import { describe, it, expect } from 'vitest';

import { chaptersFromOutline } from './pdfOutline';

const pageOffsets = [0, 100, 200, 300, 400];
const TEXT_LENGTH = 500;

describe('chaptersFromOutline', () => {
  it('ubica cada capítulo en el texto por su página', () => {
    const chapters = chaptersFromOutline(
      'bk_1',
      [
        { title: 'Prólogo', pageIndex: 0, level: 0 },
        { title: 'Capítulo 1', pageIndex: 2, level: 0 },
        { title: 'Capítulo 2', pageIndex: 4, level: 0 },
      ],
      pageOffsets,
      TEXT_LENGTH,
    );
    expect(chapters.map((c) => [c.title, c.startChar, c.endChar])).toEqual([
      ['Prólogo', 0, 200],
      ['Capítulo 1', 200, 400],
      ['Capítulo 2', 400, 500],
    ]);
    expect(chapters.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(chapters[1].id).toBe('bk_1--ch-1');
  });

  it('ordena por posición aunque el índice venga desordenado', () => {
    const chapters = chaptersFromOutline(
      'bk_1',
      [
        { title: 'B', pageIndex: 3, level: 0 },
        { title: 'A', pageIndex: 1, level: 0 },
      ],
      pageOffsets,
      TEXT_LENGTH,
    );
    expect(chapters.map((c) => c.title)).toEqual(['A', 'B']);
  });

  it('descarta niveles profundos, páginas fuera de rango y duplicados de página', () => {
    const chapters = chaptersFromOutline(
      'bk_1',
      [
        { title: 'Parte I', pageIndex: 1, level: 0 },
        { title: 'Capítulo 1', pageIndex: 1, level: 1 },
        { title: 'Sub-sub', pageIndex: 2, level: 2 },
        { title: 'Roto', pageIndex: 99, level: 0 },
        { title: 'Capítulo 2', pageIndex: 3, level: 1 },
      ],
      pageOffsets,
      TEXT_LENGTH,
    );
    expect(chapters.map((c) => c.title)).toEqual(['Parte I', 'Capítulo 2']);
  });

  it('devuelve [] si el índice no alcanza para navegar', () => {
    expect(chaptersFromOutline('bk_1', null, pageOffsets, TEXT_LENGTH)).toEqual([]);
    expect(chaptersFromOutline('bk_1', [], pageOffsets, TEXT_LENGTH)).toEqual([]);
    expect(chaptersFromOutline('bk_1', [{ title: 'Único', pageIndex: 0, level: 0 }], pageOffsets, TEXT_LENGTH)).toEqual([]);
  });
});
