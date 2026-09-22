import { describe, expect, it } from 'vitest';

import { ParsedDocument } from '../types/document';
import { getAbsoluteCharIndex } from './documentProgress';
import { pageForChar } from './pageMap';
import { buildPagePlaceholders, joinPdfPages, joinPdfPagesAsync } from './pdfPages';
import { ReadingProgress } from '../types/storage';
import { pagePercentage, positionForPage, progressFootprint, resolveSavedPosition } from './progressRemap';
import { buildTextBlocks } from './textBlocks';

function pagedDocument(fullText: string, pageOffsets: number[], hasText: boolean): ParsedDocument {
  return {
    id: 'libro',
    fileName: 'libro.pdf',
    sourceUri: 'file:///libro.pdf',
    fullText,
    blocks: buildTextBlocks(fullText),
    chapters: [],
    pdf: { pageCount: pageOffsets.length, pageAspect: 0.7, pageOffsets, crop: null, outline: [], hasText },
  };
}

const RAW_PAGES = [
  'Tapa del libro',
  'Primera página con bastante texto para que ocupe lugar. Termina acá.',
  'Segunda página, también con texto suficiente. Y otra oración más.',
  'Tercera página: la que estaba leyendo el usuario. Sigue un poco más.',
  'Cuarta y última página del libro de prueba. Fin.',
];

function quickAndFinal() {
  const placeholders = buildPagePlaceholders(RAW_PAGES.length);
  const joined = joinPdfPages(RAW_PAGES, (raw) => raw.trim());
  return {
    quick: pagedDocument(placeholders.fullText, placeholders.pageOffsets, false),
    final: pagedDocument(joined.fullText, joined.pageOffsets, true),
  };
}

describe('positionForPage', () => {
  it('cae dentro de la página pedida, en el provisorio y en el definitivo', () => {
    const { quick, final } = quickAndFinal();
    for (let page = 0; page < RAW_PAGES.length; page++) {
      expect(pageOf(quick, positionForPage(quick, page))).toBe(page);
      expect(pageOf(final, positionForPage(final, page))).toBe(page);
    }
  });

  it('una página fuera de rango se acota', () => {
    const { final } = quickAndFinal();
    const last = positionForPage(final, 999);
    const absolute = getAbsoluteCharIndex(final, last.blockIndex, last.charIndex);
    expect(pageForChar(absolute, final.pdf!.pageOffsets)).toBe(RAW_PAGES.length - 1);
  });
});

function progressAt(document: ParsedDocument, page: number, overrides: Partial<ReadingProgress> = {}): ReadingProgress {
  const position = positionForPage(document, page);
  return {
    bookId: 'libro',
    chapterId: null,
    blockIndex: position.blockIndex,
    charIndex: position.charIndex,
    percentage: position.percentage,
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...progressFootprint(document, position.absoluteCharIndex),
    ...overrides,
  };
}

function pageOf(document: ParsedDocument, position: { blockIndex: number; charIndex: number }) {
  return pageForChar(getAbsoluteCharIndex(document, position.blockIndex, position.charIndex), document.pdf!.pageOffsets);
}

describe('resolveSavedPosition', () => {
  it('mismo texto: respeta el bloque y el carácter exactos', () => {
    const { final } = quickAndFinal();
    const saved = { ...progressAt(final, 2), charIndex: 7 };
    const resumed = resolveSavedPosition(final, saved);
    expect(resumed.blockIndex).toBe(saved.blockIndex);
    expect(resumed.charIndex).toBe(7);
  });

  it('progreso guardado en el provisorio, libro abierto ya con texto: retoma por página', () => {
    const { quick, final } = quickAndFinal();
    expect(pageOf(final, resolveSavedPosition(final, progressAt(quick, 3)))).toBe(3);
  });

  it('progreso guardado con texto, libro reabierto en provisorio (caché borrado): retoma por página', () => {
    const { quick, final } = quickAndFinal();
    expect(pageOf(quick, resolveSavedPosition(quick, progressAt(final, 2)))).toBe(2);
  });

  it('progreso de una versión anterior (sin huella) sobre un provisorio: aproxima por porcentaje', () => {
    const { quick, final } = quickAndFinal();
    const legacy = progressAt(final, 4, { page: null, textLength: null });
    const page = pageOf(quick, resolveSavedPosition(quick, legacy));
    expect(page).toBeGreaterThanOrEqual(3);
  });

  it('progreso de una versión anterior sobre el texto real: se usa tal cual', () => {
    const { final } = quickAndFinal();
    const legacy = progressAt(final, 1, { page: null, textLength: null });
    expect(pageOf(final, resolveSavedPosition(final, legacy))).toBe(1);
  });

  it('sin progreso: principio del libro', () => {
    const { final } = quickAndFinal();
    expect(resolveSavedPosition(final, null).absoluteCharIndex).toBe(0);
  });
});

describe('joinPdfPagesAsync', () => {
  it('da exactamente lo mismo que la versión sincrónica, cediendo el hilo en el medio', async () => {
    const pages = Array.from({ length: 95 }, (_, i) =>
      i % 7 === 0 ? '' : `Encabezado del libro\nPágina ${i} con su texto, que sigue en la próxima sin cor-\n${i}`,
    );
    const clean = (raw: string) => raw.trim();
    let pauses = 0;
    const asyncResult = await joinPdfPagesAsync(pages, clean, async () => { pauses += 1; }, 10);
    expect(asyncResult).toEqual(joinPdfPages(pages, clean));
    expect(pauses).toBeGreaterThanOrEqual(9);
  });
});

describe('pagePercentage', () => {
  it('avanza con las páginas y llega a 100 en la última', () => {
    expect(pagePercentage(0, 24)).toBeCloseTo(4.17, 2);
    expect(pagePercentage(11, 24)).toBe(50);
    expect(pagePercentage(23, 24)).toBe(100);
  });

  it('se acota ante datos raros', () => {
    expect(pagePercentage(99, 24)).toBe(100);
    expect(pagePercentage(3, 0)).toBe(0);
  });
});
