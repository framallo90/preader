import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser } from '../types/document';

// Tope de tamaño de archivo para EPUB/DOCX/TXT. Estas rutas cargan el archivo
// entero en RAM (base64 → string → Uint8Array, ~3 copias), así que sin un guard
// un libro ilustrado grande o un zip-bomba cierran la app. Los PDF no pasan por
// acá: el módulo nativo los procesa con memoria en archivo temporal.
export const MAX_LOCAL_FILE_BYTES = 60 * 1024 * 1024; // 60 MB

/** Lanza document_too_large si el archivo supera el tope de parseo local. */
export async function assertFileSizeWithinLimit(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists && !info.isDirectory && typeof info.size === 'number' && info.size > MAX_LOCAL_FILE_BYTES) {
    throw new DocumentParseError(
      'document_too_large',
      `El archivo pesa ${(info.size / (1024 * 1024)).toFixed(0)} MB, demasiado para procesarlo en el teléfono.`,
    );
  }
}

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
        return 'El archivo ya no está disponible dentro del almacenamiento local de la app.';
      case 'empty_document':
        return 'El documento está vacío o no se pudo reconstruir texto legible.';
      case 'no_extractable_text':
        return 'Este PDF no contiene texto extraíble. Para leerlo haría falta OCR, que no forma parte de esta versión.';
      case 'document_too_large':
        return 'Este libro es demasiado grande para procesarlo en el teléfono sin quedarse sin memoria.';
      case 'extractor_unavailable':
        return 'Esta instalación no incluye el módulo PDF nativo o quedó desactualizada. Reinstalá la última versión.';
      case 'unsupported_format':
        return 'Formato no soportado. La app admite PDF, EPUB, TXT y DOCX.';
      case 'parse_failed':
      default:
        return 'No se pudo interpretar el documento seleccionado.';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'No se pudo procesar el archivo seleccionado.';
}

export type { DocumentParser };
