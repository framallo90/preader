import { ChapterInfo } from '../types/document';

/** Entrada del índice (outline) del PDF, tal como la entrega el módulo nativo. */
export type PdfOutlineEntry = {
  title: string;
  /** Página destino, base 0. */
  pageIndex: number;
  /** 0 = nivel superior. */
  level: number;
};

const MAX_LEVEL = 1;

/**
 * Capítulos a partir de un índice ya ubicado en el texto. Devuelve [] si el
 * índice no alcanza para navegar: el llamador cae a la detección por texto.
 */
export function chaptersFromToc(
  bookId: string,
  toc: { title: string; startChar: number; level: number }[] | null | undefined,
  textLength: number,
): ChapterInfo[] {
  if (!toc || toc.length === 0) return [];

  const entries = toc
    .filter((entry) => entry.level <= MAX_LEVEL && entry.title.trim().length > 0)
    .filter((entry) => entry.startChar >= 0 && entry.startChar < textLength)
    .map((entry) => ({ title: entry.title.trim().replace(/\s+/g, ' '), startChar: entry.startChar }))
    .sort((a, b) => a.startChar - b.startChar);

  // Varias entradas en el mismo lugar (parte + su primer capítulo): queda la primera.
  const unique = entries.filter((entry, index) => index === 0 || entry.startChar !== entries[index - 1].startChar);
  if (unique.length < 2) return [];

  return unique.map((entry, index) => ({
    id: `${bookId}--ch-${index}`,
    title: entry.title,
    povCharacter: null,
    povNumber: null,
    orderIndex: index,
    startChar: entry.startChar,
    endChar: index + 1 < unique.length ? unique[index + 1].startChar : textLength,
  }));
}

/**
 * Capítulos a partir del índice real de un PDF (lo que el autor o la editorial
 * marcaron), usando el mapa de páginas para ubicar cada uno en el texto.
 */
export function chaptersFromOutline(
  bookId: string,
  outline: PdfOutlineEntry[] | null | undefined,
  pageOffsets: number[],
  textLength: number,
): ChapterInfo[] {
  if (!outline || pageOffsets.length === 0) return [];
  const toc = outline
    .filter((entry) => entry.pageIndex >= 0 && entry.pageIndex < pageOffsets.length)
    .map((entry) => ({ title: entry.title, startChar: pageOffsets[entry.pageIndex], level: entry.level }));
  return chaptersFromToc(bookId, toc, textLength);
}
