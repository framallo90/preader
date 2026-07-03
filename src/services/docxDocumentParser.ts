import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import mammoth from 'mammoth';

import { DocumentMetadata, DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { detectChapters } from '../utils/chapterDetector';
import { DocumentParseError } from './documentParser';

/** Lee título y autor de docProps/core.xml (un .docx es un zip). */
async function extractDocxMetadata(base64: string): Promise<DocumentMetadata> {
  const empty: DocumentMetadata = { title: null, author: null, coverBase64: null, coverExtension: null };

  try {
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const coreXml = await zip.file('docProps/core.xml')?.async('string');
    if (!coreXml) return empty;

    const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreXml)?.[1]?.trim() || null;
    const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(coreXml)?.[1]?.trim() || null;

    return { title, author, coverBase64: null, coverExtension: null };
  } catch {
    return empty;
  }
}

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
      const metadata = await extractDocxMetadata(base64);

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters,
        metadata,
      };
    } catch (error) {
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el documento Word.';
      throw new DocumentParseError('parse_failed', message);
    }
  }
}

export const docxDocumentParser = new DocxDocumentParser();
