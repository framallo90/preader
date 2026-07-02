import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

import { DocumentParser, ParsedDocument } from '../types/document';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { detectChapters } from '../utils/chapterDetector';
import { DocumentParseError } from './documentParser';

/**
 * Extrae texto limpio de un string HTML de EPUB.
 * Elimina tags, scripts, y normaliza entidades HTML básicas.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .trim();
}

/**
 * Lee el archivo OPF del EPUB para obtener el orden correcto de los archivos de contenido.
 */
function parseSpineOrder(opfContent: string, opfDir: string): string[] {
  const idToHref = new Map<string, string>();

  // Extraer manifest items
  const manifestMatches = opfContent.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"/gi);
  for (const match of manifestMatches) {
    idToHref.set(match[1], match[2]);
  }

  // Extraer spine en orden
  const spineMatches = opfContent.matchAll(/<itemref[^>]+idref="([^"]+)"/gi);
  const hrefs: string[] = [];

  for (const match of spineMatches) {
    const href = idToHref.get(match[1]);
    if (href) {
      // Construir path relativo al directorio del OPF
      const fullPath = opfDir ? `${opfDir}/${href}` : href;
      hrefs.push(fullPath);
    }
  }

  return hrefs;
}

class EpubDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }

    try {
      // Leer el EPUB como base64 y pasarlo a JSZip
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const zip = await JSZip.loadAsync(base64, { base64: true });

      // Encontrar el archivo OPF (container.xml apunta a él)
      const containerXml = await zip.file('META-INF/container.xml')?.async('string');

      if (!containerXml) {
        throw new DocumentParseError('parse_failed', 'El EPUB no tiene un container.xml válido.');
      }

      const opfPathMatch = /full-path="([^"]+\.opf)"/i.exec(containerXml);

      if (!opfPathMatch) {
        throw new DocumentParseError('parse_failed', 'No se encontró el archivo OPF en el EPUB.');
      }

      const opfPath = opfPathMatch[1];
      const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') : '';
      const opfContent = await zip.file(opfPath)?.async('string');

      if (!opfContent) {
        throw new DocumentParseError('parse_failed', 'No se pudo leer el archivo OPF del EPUB.');
      }

      const spineFiles = parseSpineOrder(opfContent, opfDir);

      if (spineFiles.length === 0) {
        throw new DocumentParseError('parse_failed', 'El EPUB no tiene contenido en el spine.');
      }

      // Extraer texto de cada archivo en orden del spine
      const textParts: string[] = [];

      for (const filePath of spineFiles) {
        const file = zip.file(filePath);
        if (!file) continue;

        const html = await file.async('string');
        const text = stripHtml(html);

        if (text.trim()) {
          textParts.push(text);
        }
      }

      const rawText = textParts.join('\n\n');
      const fullText = normalizeExtractedText(rawText);

      if (!fullText) {
        throw new DocumentParseError('no_extractable_text', 'El EPUB no contiene texto legible.');
      }

      const blocks = buildTextBlocks(fullText);

      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      const fileName = uri.split('/').pop() ?? 'documento.epub';
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

      const message = error instanceof Error ? error.message : 'No se pudo leer el EPUB.';
      throw new DocumentParseError('parse_failed', message);
    }
  }
}

export const epubDocumentParser = new EpubDocumentParser();
