import * as FileSystem from 'expo-file-system/legacy';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { detectChapters } from '../utils/chapterDetector';
import { DocumentParseError } from './documentParser';

class TxtDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }

    const rawText = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (!rawText?.trim()) {
      throw new DocumentParseError('no_extractable_text', 'El archivo de texto está vacío.');
    }

    const fullText = normalizeExtractedText(rawText);
    const blocks = buildTextBlocks(fullText);

    if (blocks.length === 0) {
      throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
    }

    const fileName = uri.split('/').pop() ?? 'documento.txt';
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
  }
}

export const txtDocumentParser = new TxtDocumentParser();
