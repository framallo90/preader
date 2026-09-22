import { ParsedDocument } from '../types/document';
import { ReadingProgress } from '../types/storage';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from './documentProgress';
import { charForPage, pageForChar } from './pageMap';

/** Posición (bloque, carácter, porcentaje) donde empieza una página. */
export function positionForPage(document: ParsedDocument, page: number) {
  if (!document.pdf) return getPositionFromAbsoluteChar(document, 0);
  const safePage = Math.min(Math.max(page, 0), Math.max(document.pdf.pageOffsets.length - 1, 0));
  // Documento provisorio: el "texto" de la página es su número, así que el medio
  // cae siempre dentro de la página. En el definitivo una página puede estar vacía
  // (una lámina): su medio coincide con el comienzo de la siguiente, que igual
  // pageForChar resuelve a la última página que empieza ahí.
  const absolute = charForPage(safePage, document.pdf.pageOffsets, document.fullText.length);
  return getPositionFromAbsoluteChar(document, absolute);
}

/**
 * Dónde retomar la lectura en ESTE documento. blockIndex/charIndex solo valen si se
 * midieron sobre el mismo texto; si no (documento provisorio, libro re-procesado,
 * progreso de una versión anterior) se retoma por página, o por porcentaje.
 */
export function resolveSavedPosition(document: ParsedDocument, progress: ReadingProgress | null) {
  if (!progress) return getPositionFromAbsoluteChar(document, 0);

  // Un progreso sin huella viene de una versión anterior: se midió sobre texto real,
  // así que nunca corresponde a un documento provisorio.
  const sameText =
    progress.textLength === null
      ? !document.pdf?.textPending
      : progress.textLength === document.fullText.length;
  if (sameText) {
    const absolute = getAbsoluteCharIndex(document, progress.blockIndex, progress.charIndex);
    return getPositionFromAbsoluteChar(document, absolute);
  }

  const fraction = Math.min(Math.max(progress.percentage / 100, 0), 1);
  if (document.pdf) {
    const page = progress.page ?? Math.round(fraction * Math.max(document.pdf.pageCount - 1, 0));
    return positionForPage(document, page);
  }
  return getPositionFromAbsoluteChar(document, Math.round(fraction * document.fullText.length));
}

/** Lo que hay que guardar junto al progreso para poder retomarlo en cualquier versión del libro. */
export function progressFootprint(document: ParsedDocument, absoluteCharIndex: number) {
  return {
    page: document.pdf ? pageForChar(absoluteCharIndex, document.pdf.pageOffsets) : null,
    textLength: document.fullText.length,
  };
}

/**
 * Avance de un libro por páginas: página actual sobre el total. El porcentaje medido
 * en el texto engaña cuando hay páginas sin texto (un libro ilustrado marcaba 100%
 * por la mitad) y no existe en un cómic.
 */
export function pagePercentage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  const fraction = Math.min(Math.max((page + 1) / pageCount, 0), 1);
  return Number((fraction * 100).toFixed(2));
}
