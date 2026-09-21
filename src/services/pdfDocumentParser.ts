import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { cleanPdfProse, cleanPdfTabArtifacts, detectChapters } from '../utils/chapterDetector';
import { buildPagePlaceholders, joinPdfPages } from '../utils/pdfPages';
import { DocumentParseError } from './documentParser';
import { detectPdfCrop, extractPdfPages, getPdfInfo, isLocalPdfAvailable } from './pdfLocalService';

function countExtractableCharacters(text: string) {
  // Letras/dígitos Unicode, no solo ASCII: un libro en cirílico, griego, árabe o
  // CJK tiene texto perfecto pero 0 chars [A-Za-z0-9] → se rechazaba como "escaneo".
  return text.replace(/[^\p{L}\p{N}]/gu, '').length;
}

// El texto completo vive en memoria como un string de JS (el lector y la voz
// trabajan con offsets sobre él). Este tope protege de archivos patológicos; un
// tomo de 1000+ páginas ronda los 2-3 M de caracteres.
const MAX_DOCUMENT_CHAR_COUNT = 12_000_000;

/** Misma limpieza para cada página, en el mismo orden de siempre. */
function cleanPageText(raw: string) {
  return normalizeExtractedText(cleanPdfProse(cleanPdfTabArtifacts(raw)));
}

function toDocumentParseError(error: unknown) {
  if (error instanceof DocumentParseError) return error;

  const message = error instanceof Error ? error.message : 'No se pudo interpretar el PDF.';
  const code = (error as { code?: string } | null)?.code;

  if (code === 'ERR_PDF_TOO_LARGE') return new DocumentParseError('document_too_large', message);
  if (code === 'ERR_PDF_PASSWORD') return new DocumentParseError('parse_failed', message);
  if (message.includes('Cannot find native module') || message.includes('development build')) {
    return new DocumentParseError('extractor_unavailable', 'La build actual no incluye el módulo PDF nativo.');
  }
  return new DocumentParseError('parse_failed', message);
}

export type PdfParseProgress = (done: number, total: number) => void;

class PdfDocumentParser implements DocumentParser {
  async parse(uri: string, onProgress?: PdfParseProgress): Promise<ParsedDocument> {
    if (!isLocalPdfAvailable()) {
      throw new DocumentParseError('extractor_unavailable', 'La build actual no incluye el módulo PDF nativo.');
    }

    if (!uri.startsWith('content://')) {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
      }
    }

    try {
      // El documento se abre UNA vez y devuelve el texto de todas las páginas.
      const extraction = await extractPdfPages(uri, onProgress);
      const joined = joinPdfPages(extraction.pages, cleanPageText);

      if (joined.fullText.length > MAX_DOCUMENT_CHAR_COUNT) {
        throw new DocumentParseError('document_too_large', 'El libro es demasiado grande para procesarlo en el teléfono.');
      }

      // Un escaneo no tiene texto, pero sus páginas se pueden leer igual: se abre
      // en modo visual, sin voz.
      const hasText = countExtractableCharacters(joined.fullText) >= 20;
      if (!hasText && extraction.pages.length === 0) {
        throw new DocumentParseError('empty_document', 'El PDF no tiene páginas.');
      }
      const { fullText, pageOffsets } = hasText ? joined : buildPagePlaceholders(extraction.pages.length);

      const blocks = buildTextBlocks(fullText);
      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      // Proporción de página y recorte de márgenes: si fallan, el lector igual
      // funciona (asume A4 y página completa).
      const info = await getPdfInfo(uri).catch(() => null);
      const crop = await detectPdfCrop(uri).catch(() => null);

      const fileName = uri.split('/').pop() ?? 'documento.pdf';
      const documentId = fileName;

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters: hasText ? detectChapters(documentId, fullText) : [],
        pdf: {
          pageCount: info?.pageCount ?? extraction.pages.length,
          pageAspect: info?.pageAspect ?? null,
          pageOffsets,
          crop,
          outline: Array.isArray(extraction.outline) ? extraction.outline : [],
          hasText,
        },
        metadata: {
          title: extraction.title,
          author: extraction.author,
          coverBase64: null,
          coverExtension: null,
        },
      };
    } catch (error) {
      throw toDocumentParseError(error);
    }
  }
}

export const pdfDocumentParser = new PdfDocumentParser();
