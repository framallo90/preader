import { DocumentParser } from '../types/document';
import { DocumentParseError } from './documentParser';
import { pdfDocumentParser } from './pdfDocumentParser';

export function getParserForDocument(type?: string | null, fileName?: string): DocumentParser {
  const lowerFileName = fileName?.toLowerCase() ?? '';
  const lowerType = type?.toLowerCase() ?? '';

  if (lowerType === 'application/pdf' || lowerFileName.endsWith('.pdf')) {
    return pdfDocumentParser;
  }

  throw new DocumentParseError('unsupported_format', 'Solo se admite PDF por ahora.');
}
