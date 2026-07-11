import { DocumentParser } from '../types/document';

export type DocumentParseErrorCode =
  | 'missing_file'
  | 'empty_document'
  | 'no_extractable_text'
  | 'document_too_large'
  | 'extractor_unavailable'
  | 'unsupported_format'
  | 'parse_failed';

export class DocumentParseError extends Error {
  constructor(
    public readonly code: DocumentParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentParseError';
  }
}

export function getFriendlyParseErrorMessage(error: unknown) {
  if (error instanceof DocumentParseError) {
    switch (error.code) {
      case 'missing_file':
        return 'El archivo ya no esta disponible dentro del almacenamiento local de la app.';
      case 'empty_document':
        return 'El documento esta vacio o no se pudo reconstruir texto legible.';
      case 'no_extractable_text':
        return 'Este PDF no contiene texto extraible. Para leerlo haria falta OCR, que no forma parte de esta primera version.';
      case 'document_too_large':
        return 'Este libro es demasiado grande (miles de paginas) para procesarlo en el telefono sin quedarse sin memoria. Los volumenes enormes hay que dividirlos en partes o procesarlos en un servidor.';
      case 'extractor_unavailable':
        return 'Esta APK no incluye el extractor PDF nativo o la instalacion quedo desactualizada. Rehace la build con EAS e instala la APK nueva.';
      case 'unsupported_format':
        return 'Formato no soportado. La app admite PDF, EPUB, TXT y DOCX.';
      case 'parse_failed':
      default:
        return 'No se pudo interpretar el PDF seleccionado.';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'No se pudo procesar el archivo seleccionado.';
}

export type { DocumentParser };
