/**
 * Qué parser le toca a cada libro. Los parsers se cargan POR DEMANDA: el de
 * DOCX arrastra mammoth y el de EPUB puede arrastrar JSZip, y eso no tiene por
 * qué evaluarse al abrir la app si nunca abrís un .docx.
 */
import { DocumentParser } from '../types/document';
import {
  COMIC_MIME_TYPE,
  DOCX_MIME_TYPE,
  EPUB_MIME_TYPE,
  PDF_MIME_TYPE,
  PICKER_MIME_TYPES,
  SUPPORTED_MIME_TYPES,
  TXT_MIME_TYPE,
  isComicFile,
  isPdfFile,
  resolveBookType,
} from './bookTypes';
import { DocumentParseError } from './documentParser';

export {
  COMIC_MIME_TYPE,
  DOCX_MIME_TYPE,
  EPUB_MIME_TYPE,
  PDF_MIME_TYPE,
  PICKER_MIME_TYPES,
  SUPPORTED_MIME_TYPES,
  TXT_MIME_TYPE,
  isComicFile,
  isPdfFile,
  resolveBookType,
};

// require() a propósito: es lo que hace que el parser se evalúe recién cuando se
// abre un libro de ese formato. Con import estático, abrir la app cargaba
// mammoth y JSZip aunque nunca tocaras un .docx.
/* eslint-disable @typescript-eslint/no-require-imports */
export function getParserForDocument(mimeType: string | null, fileName?: string): DocumentParser {
  if (isPdfFile(mimeType, fileName)) {
    return require('./pdfDocumentParser').pdfDocumentParser;
  }
  if (isComicFile(mimeType, fileName)) {
    return require('./comicDocumentParser').comicDocumentParser;
  }
  if (mimeType === EPUB_MIME_TYPE || (fileName && /\.epub$/i.test(fileName))) {
    return require('./epubDocumentParser').epubDocumentParser;
  }
  if (mimeType === TXT_MIME_TYPE || (fileName && /\.txt$/i.test(fileName))) {
    return require('./txtDocumentParser').txtDocumentParser;
  }
  if (mimeType === DOCX_MIME_TYPE || (fileName && /\.docx$/i.test(fileName))) {
    return require('./docxDocumentParser').docxDocumentParser;
  }
  throw new DocumentParseError(
    'unsupported_format',
    `Formato no soportado: ${mimeType ?? fileName ?? "desconocido"}`,
  );
}
