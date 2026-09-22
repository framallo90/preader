import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

import { getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';
import mammoth from 'mammoth';

import { ChapterInfo, DocumentMetadata, DocumentParser, ParsedDocument } from '../types/document';
import { buildAutoSummary, cleanMetadataSummary } from '../utils/bookSummary';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { DocumentParseError, assertFileSizeWithinLimit } from './documentParser';

/** Lee título y autor de docProps/core.xml (un .docx es un zip). */
const NO_METADATA: DocumentMetadata = { title: null, author: null, summary: null, coverBase64: null, coverExtension: null };

function parseCoreXml(coreXml: string): DocumentMetadata {
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreXml)?.[1]?.trim() || null;
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(coreXml)?.[1]?.trim() || null;
  const description = /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i.exec(coreXml)?.[1] ?? null;
  return { title, author, summary: cleanMetadataSummary(description), coverBase64: null, coverExtension: null };
}

/**
 * Título y autor de un .docx (que es un zip): se lee SOLO `docProps/core.xml`.
 *
 * Antes esto descomprimía el archivo ENTERO por segunda vez con JSZip —mammoth
 * ya lo había abierto— nada más que para sacar dos campos. En un documento
 * grande eso es decenas de MB y varios segundos de más.
 */
async function extractDocxMetadata(uri: string): Promise<DocumentMetadata> {
  if (isBardoArchiveAvailable()) {
    try {
      const [coreXml] = await getBardoArchiveModule().readTextAsync(uri, ['docProps/core.xml']);
      if (coreXml) return parseCoreXml(coreXml);
    } catch {
      // Sigue con la vía de respaldo.
    }
  }
  // Plan B (build sin el módulo nativo): como antes.
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const coreXml = await zip.file('docProps/core.xml')?.async('string');
    return coreXml ? parseCoreXml(coreXml) : NO_METADATA;
  } catch {
    return NO_METADATA;
  }
}

/**
 * El archivo como bytes, para mammoth.
 *
 * Va en su propia función A PROPÓSITO: el texto base64 y el binario intermedio
 * son cada uno del tamaño del documento y, declarados en el cuerpo del parser,
 * seguían vivos hasta el final (cuatro representaciones del mismo archivo a la
 * vez). Acá mueren al salir.
 */
async function readAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

class DocxDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }
    await assertFileSizeWithinLimit(uri);

    try {
      // Primero lo barato: título y autor, leyendo una sola entrada del zip.
      const metadata = await extractDocxMetadata(uri);

      const result = await mammoth.extractRawText({ arrayBuffer: await readAsArrayBuffer(uri) });

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
      const chapters: ChapterInfo[] = []; // los resuelve el lector (resolveChapters)
      // Si el .docx no declara sinopsis, se arma con las primeras líneas.
      const conResumen: DocumentMetadata = {
        ...metadata,
        summary: metadata.summary ?? buildAutoSummary(fullText),
      };

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters,
        metadata: conResumen,
      };
    } catch (error) {
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el documento Word.';
      throw new DocumentParseError('parse_failed', message);
    }
  }
}

export const docxDocumentParser = new DocxDocumentParser();
