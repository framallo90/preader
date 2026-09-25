import { ParsedDocument } from '../types/document';
import { ReadingProgress } from '../types/storage';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from './documentProgress';
import { charForPage, pageForChar, pageForProgress } from './pageMap';

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

/**
 * Dónde queda la lectura cuando llega el texto definitivo de un PDF que se abrió
 * con el documento provisorio ("Página 1", "Página 2"…).
 *
 * Antes se retomaba SIEMPRE en el medio de la página que se estaba viendo
 * (`positionForPage`), aunque el progreso guardado tuviera la posición exacta,
 * medida sobre este mismo texto. Cada reapertura corría la lectura media página:
 * "vuelve, pero más adelantado". Ahora, en orden:
 *
 * 1. Un salto pedido (índice, cita, marcador) manda: se mide sobre el texto real.
 * 2. Si el progreso guardado se midió sobre este mismo texto y cae en la página
 *    que se está viendo, se retoma EXACTO ahí.
 * 3. Si no (pasaste de página mientras el texto se preparaba, el progreso es del
 *    provisorio, o el libro se re-procesó), se retoma por la página que se ve.
 */
export function positionWhenTextReady(
  ready: ParsedDocument,
  stored: ReadingProgress | null,
  currentPage: number,
  jumpChar: number | null,
) {
  if (jumpChar !== null) return getPositionFromAbsoluteChar(ready, jumpChar);
  if (stored && ready.pdf && stored.textLength === ready.fullText.length) {
    const exact = resolveSavedPosition(ready, stored);
    const page = pageForProgress(exact.absoluteCharIndex, stored.page, ready.pdf.pageOffsets, ready.fullText.length);
    if (page === currentPage) return exact;
  }
  return positionForPage(ready, currentPage);
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
