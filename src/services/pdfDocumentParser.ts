import { extractText, extractTextFromPage, getPageCount, isAvailable } from 'expo-pdf-text-extract';
import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { cleanPdfProse, cleanPdfTabArtifacts, detectChapters } from '../utils/chapterDetector';
import { DocumentParseError } from './documentParser';

function countExtractableCharacters(text: string) {
  return text.replace(/[^A-Za-z0-9]/g, '').length;
}

// Límites de seguridad REALES de memoria del dispositivo. Esta arquitectura carga
// el PDF entero en RAM (texto completo + bloques + caché), y eso no escala: un
// libro de ~6000 páginas (~12M caracteres) hace OOM y CIERRA la app. Por eso
// frenamos ANTES de intentar procesarlo, con un mensaje claro, en vez de crashear.
// Un libro normal (incluso tomos de 1000+ páginas / ~2M chars) entra sin problema;
// solo los volúmenes gigantes se rechazan. Para esos, la solución real es procesar
// en un servidor, no en el teléfono.
const SAFE_PAGE_LIMIT = 2500;
const MAX_DOCUMENT_CHAR_COUNT = 5_000_000;

async function extractPdfTextPageByPage(uri: string, pageCount: number) {
  let totalChars = 0;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pageText = await extractTextFromPage(uri, pageNumber);

    if (!pageText.trim()) {
      continue;
    }

    totalChars += pageText.length + 2;

    if (totalChars > MAX_DOCUMENT_CHAR_COUNT) {
      throw new DocumentParseError(
        'document_too_large',
        'El PDF supera el tamano seguro que esta build puede manejar.',
      );
    }

    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n');
}

async function extractPdfText(uri: string) {
  const pageCount = await getPageCount(uri).catch(() => 0);

  // Guard barato ANTES de extraer: getPageCount es una llamada nativa liviana.
  // Un libro que supera el límite de páginas no cabe en memoria → se frena acá
  // con un mensaje, en vez de intentar cargarlo y cerrar la app por OOM.
  if (pageCount > SAFE_PAGE_LIMIT) {
    throw new DocumentParseError(
      'document_too_large',
      `El libro tiene ${pageCount} páginas: es demasiado para procesar en el teléfono sin quedarse sin memoria.`,
    );
  }

  // Una sola pasada nativa es MUCHÍSIMO más rápida que página por página
  // (abre el PDF una vez, en vez de N llamadas al bridge por cada página) y
  // suele dar texto más limpio (sin artefactos de borde de página).
  try {
    const rawText = await extractText(uri);
    if (rawText && rawText.trim()) {
      if (rawText.length > MAX_DOCUMENT_CHAR_COUNT) {
        throw new DocumentParseError(
          'document_too_large',
          'El libro es demasiado grande para procesarlo en el teléfono.',
        );
      }
      return rawText;
    }
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    // Cae al método por página si extractText falló o vino vacío.
  }

  if (pageCount > 0) {
    return extractPdfTextPageByPage(uri, pageCount);
  }

  return extractText(uri);
}

function toDocumentParseError(error: unknown) {
  if (error instanceof DocumentParseError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'No se pudo interpretar el PDF.';

  if (message.includes('development build') || message.includes('Native module not available')) {
    return new DocumentParseError(
      'extractor_unavailable',
      'La build actual no incluye el extractor PDF nativo.',
    );
  }

  return new DocumentParseError('parse_failed', message);
}

class PdfDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    if (!isAvailable()) {
      throw new DocumentParseError(
        'extractor_unavailable',
        'La build actual no incluye el extractor PDF nativo.',
      );
    }

    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }

    try {
      const rawText = await extractPdfText(uri);
      // Limpia artefactos de conversión ePUB→PDF antes de normalizar
      const cleanedRaw = cleanPdfProse(cleanPdfTabArtifacts(rawText));
      const fullText = normalizeExtractedText(cleanedRaw);

      if (!fullText) {
        throw new DocumentParseError(
          'no_extractable_text',
          'El PDF no devolvio texto visible. Puede ser un escaneo o un PDF protegido.',
        );
      }

      if (countExtractableCharacters(fullText) < 20) {
        throw new DocumentParseError(
          'no_extractable_text',
          'El PDF parece ser un escaneo o solo contiene imagenes.',
        );
      }

      const blocks = buildTextBlocks(fullText);

      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      const fileName = uri.split('/').pop() ?? 'documento.pdf';
      const documentId = fileName;
      const chapters = detectChapters(documentId, fullText);

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters,
      };
    } catch (error) {
      throw toDocumentParseError(error);
    }
  }
}

export const pdfDocumentParser = new PdfDocumentParser();
