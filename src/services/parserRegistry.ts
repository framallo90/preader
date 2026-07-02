import { DocumentParser } from '../types/document';
import { DocumentParseError } from './documentParser';
import { pdfDocumentParser } from './pdfDocumentParser';
import { epubDocumentParser } from './epubDocumentParser';
import { txtDocumentParser } from './txtDocumentParser';
import { docxDocumentParser } from './docxDocumentParser';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/epub+zip',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export function getParserForDocument(mimeType: string | null, fileName?: string): DocumentParser {
  if (mimeType === 'application/pdf' || (fileName && /\.pdf$/i.test(fileName))) {
    return pdfDocumentParser;
  }
  if (mimeType === 'application/epub+zip' || (fileName && /\.epub$/i.test(fileName))) {
    return epubDocumentParser;
  }
  if (mimeType === 'text/plain' || (fileName && /\.txt$/i.test(fileName))) {
    return txtDocumentParser;
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (fileName && /\.docx$/i.test(fileName))
  ) {
    return docxDocumentParser;
  }
  throw new DocumentParseError(
    'unsupported_format',
    `Formato no soportado: ${mimeType ?? fileName ?? 'desconocido'}`,
  );
}
