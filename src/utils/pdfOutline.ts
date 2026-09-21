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
 * Capítulos a partir del índice real del documento (lo que el autor o la
 * editorial marcaron), usando el mapa de páginas para ubicar cada uno en el texto.
 * Devuelve [] si el índice no sirve: el llamador cae a la detección por texto.
 */
export function chaptersFromOutline(
  bookId: string,
  outline: PdfOutlineEntry[] | null | undefined,
  pageOffsets: number[],
  textLength: number,
): ChapterInfo[] {
  if (!outline || outline.length === 0 || pageOffsets.length === 0) return [];

  const entries = outline
    .filter((entry) => entry.level <= MAX_LEVEL && entry.title.trim().length > 0)
    .filter((entry) => entry.pageIndex >= 0 && entry.pageIndex < pageOffsets.length)
    .map((entry) => ({ title: entry.title.trim().replace(/\s+/g, ' '), startChar: pageOffsets[entry.pageIndex] }))
    .sort((a, b) => a.startChar - b.startChar);

  // Varias entradas en la misma página (capítulo + su primera sección): queda la primera.
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
