import * as FileSystem from 'expo-file-system/legacy';

import { ChapterInfo, DocumentParser, ParsedDocument } from '../types/document';
import { buildAutoSummary } from '../utils/bookSummary';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { DocumentParseError, assertFileSizeWithinLimit } from './documentParser';

class TxtDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }
    await assertFileSizeWithinLimit(uri);

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
    const chapters: ChapterInfo[] = []; // los resuelve el lector (resolveChapters)

    return {
      id: documentId,
      fileName,
      sourceUri: uri,
      fullText,
      blocks,
      chapters,
      // Un .txt no trae metadata: el resumen sale de sus primeras líneas.
      metadata: {
        title: null,
        author: null,
        summary: buildAutoSummary(fullText),
        coverBase64: null,
        coverExtension: null,
      },
    };
  }
}

export const txtDocumentParser = new TxtDocumentParser();
