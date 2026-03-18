import { extractText, extractTextFromPage, getPageCount, isAvailable } from 'expo-pdf-text-extract';
import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { DocumentParseError } from './documentParser';

function countExtractableCharacters(text: string) {
  return text.replace(/[^A-Za-z0-9]/g, '').length;
}

const LARGE_DOCUMENT_PAGE_THRESHOLD = 120;
const MAX_DOCUMENT_CHAR_COUNT = 1_200_000;

async function extractLargePdfText(uri: string, pageCount: number) {
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

  if (pageCount >= LARGE_DOCUMENT_PAGE_THRESHOLD) {
    return extractLargePdfText(uri, pageCount);
  }

  try {
    const rawText = await extractText(uri);

    if (rawText.length > MAX_DOCUMENT_CHAR_COUNT && pageCount > 0) {
      return extractLargePdfText(uri, pageCount);
    }

    return rawText;
  } catch (error) {
    if (pageCount > 0) {
      return extractLargePdfText(uri, pageCount);
    }

    throw error;
  }
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
      const fullText = normalizeExtractedText(rawText);

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

      return {
        id: fileName,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
      };
    } catch (error) {
      throw toDocumentParseError(error);
    }
  }
}

export const pdfDocumentParser = new PdfDocumentParser();
