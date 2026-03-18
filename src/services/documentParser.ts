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
        return 'Este PDF es demasiado grande para que esta version lo procese de forma segura en memoria. Estoy priorizando estabilidad para evitar cierres de la app.';
      case 'extractor_unavailable':
        return 'Esta APK no incluye el extractor PDF nativo o la instalacion quedo desactualizada. Rehace la build con EAS e instala la APK nueva.';
      case 'unsupported_format':
        return 'Por ahora el MVP solo admite PDF. La arquitectura ya quedo lista para sumar DOCX, TXT o EPUB mas adelante.';
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
