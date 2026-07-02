import * as FileSystem from 'expo-file-system/legacy';
import mammoth from 'mammoth';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { detectChapters } from '../utils/chapterDetector';
import { DocumentParseError } from './documentParser';

class DocxDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Convertir base64 a ArrayBuffer para mammoth
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result.value?.trim()) {
        throw new DocumentParseError('no_extractable_text', 'El documento Word está vacío o no tiene texto extraíble.');
      }

      const fullText = normalizeExtractedText(result.value);
      const blocks = buildTextBlocks(fullText);

      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      const fileName = uri.split('/').pop() ?? 'documento.docx';
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
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el documento Word.';
      throw new DocumentParseError('parse_failed', message);
    }
  }
}

export const docxDocumentParser = new DocxDocumentParser();
