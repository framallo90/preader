import { ChapterInfo, ParsedDocument } from '../types/document';
import { detectChapters } from './chapterDetector';
import { chaptersFromOutline, chaptersFromToc } from './pdfOutline';

/**
 * Capítulos del libro: primero el índice real (marcadores del PDF o índice del
 * EPUB); si no trae, la detección sobre el texto (encabezados POV, etc.).
 */
export function resolveChapters(bookId: string, doc: ParsedDocument): ChapterInfo[] {
  if (doc.pdf) {
    const fromOutline = chaptersFromOutline(bookId, doc.pdf.outline, doc.pdf.pageOffsets, doc.fullText.length);
    if (fromOutline.length > 0) return fromOutline;
    // Sin texto (escaneo, cómic o texto todavía en preparación) no hay nada que detectar.
    if (!doc.pdf.hasText) return [];
  }
  if (doc.toc) {
    const fromToc = chaptersFromToc(bookId, doc.toc, doc.fullText.length);
    if (fromToc.length > 0) return fromToc;
  }
  return detectChapters(bookId, doc.fullText);
}
