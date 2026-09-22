import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser, ParsedDocument, PdfPageInfo } from '../types/document';
import { buildAutoSummary, cleanMetadataSummary } from '../utils/bookSummary';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { cleanPdfProse, cleanPdfTabArtifacts } from '../utils/chapterDetector';
import { buildPagePlaceholders, joinPdfPagesAsync } from '../utils/pdfPages';
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

/** Cede el hilo de JS: el libro ya está en pantalla mientras se prepara el texto. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function fileNameOf(uri: string) {
  return uri.split('/').pop() ?? 'documento.pdf';
}

/** Documento de una línea por página: alcanza para leer, guardar progreso y marcar páginas. */
function placeholderDocument(uri: string, pdf: Omit<PdfPageInfo, 'pageOffsets'>): ParsedDocument {
  const { fullText, pageOffsets } = buildPagePlaceholders(pdf.pageCount);
  const fileName = fileNameOf(uri);
  return {
    id: fileName,
    fileName,
    sourceUri: uri,
    fullText,
    blocks: buildTextBlocks(fullText),
    chapters: [],
    pdf: { ...pdf, pageOffsets },
  };
}

/**
 * Apertura instantánea: solo cuenta las páginas. El libro se empieza a leer ya;
 * el texto (voz, búsqueda, índice) lo prepara después preparePdfText, de fondo.
 * Así abre ReadEra: por página y a demanda, sin procesar el libro antes.
 */
export async function openPdfQuick(uri: string): Promise<ParsedDocument> {
  if (!isLocalPdfAvailable()) {
    throw new DocumentParseError('extractor_unavailable', 'La build actual no incluye el módulo PDF nativo.');
  }
  try {
    const info = await getPdfInfo(uri);
    if (info.pageCount <= 0) throw new DocumentParseError('empty_document', 'El PDF no tiene páginas.');
    return placeholderDocument(uri, {
      pageCount: info.pageCount,
      pageAspect: info.pageAspect,
      crop: null,
      outline: [],
      hasText: false,
      textPending: true,
    });
  } catch (error) {
    throw toDocumentParseError(error);
  }
}

/** Versión final de un PDF sin texto utilizable (escaneo, o no se pudo extraer). */
export function withoutText(quick: ParsedDocument, crop: PdfPageInfo['crop'] = null): ParsedDocument {
  if (!quick.pdf) return quick;
  return { ...quick, pdf: { ...quick.pdf, crop, hasText: false, textPending: false } };
}

/** Documento completo: texto de todas las páginas, mapa texto↔página, índice y recorte. */
export async function buildPdfDocument(
  uri: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ParsedDocument> {
  try {
    const extraction = await extractPdfPages(uri, onProgress);
    const joined = await joinPdfPagesAsync(extraction.pages, cleanPageText, pause);

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

    await pause();
    const blocks = buildTextBlocks(fullText);
    if (blocks.length === 0) {
      throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
    }

    // Proporción de página y recorte de márgenes: si fallan, el lector igual
    // funciona (asume A4 y página completa).
    await pause();
    const info = await getPdfInfo(uri).catch(() => null);
    const crop = await detectPdfCrop(uri).catch(() => null);

    const fileName = fileNameOf(uri);
    return {
      id: fileName,
      fileName,
      sourceUri: uri,
      fullText,
      blocks,
      // Los capítulos los resuelve quien llama (índice real o detección en el texto).
      chapters: [],
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
        // El PDF declara su sinopsis en "Subject"; si no la trae, más abajo se
        // arma una con las primeras líneas del libro.
        summary: cleanMetadataSummary(extraction.subject) ?? (hasText ? buildAutoSummary(fullText) : null),
        coverBase64: null,
        coverExtension: null,
      },
    };
  } catch (error) {
    throw toDocumentParseError(error);
  }
}

class PdfDocumentParser implements DocumentParser {
  async parse(uri: string, onProgress?: (done: number, total: number) => void): Promise<ParsedDocument> {
    if (!isLocalPdfAvailable()) {
      throw new DocumentParseError('extractor_unavailable', 'La build actual no incluye el módulo PDF nativo.');
    }
    if (!uri.startsWith('content://')) {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
      }
    }
    return buildPdfDocument(uri, onProgress);
  }
}

export const pdfDocumentParser = new PdfDocumentParser();
