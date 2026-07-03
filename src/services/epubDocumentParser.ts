import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

import { DocumentMetadata, DocumentParser, ParsedDocument } from '../types/document';
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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Extrae título, autor y la ruta de la portada desde el OPF.
 * Soporta EPUB 3 (item properties="cover-image") y EPUB 2 (meta name="cover").
 */
function parseOpfMetadata(opfContent: string): { title: string | null; author: string | null; coverHref: string | null } {
  const titleMatch = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfContent);
  const authorMatch = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opfContent);

  let coverHref: string | null = null;

  // EPUB 3: <item ... properties="...cover-image..." href="..."/>
  const coverItemTag = /<item[^>]+properties="[^"]*cover-image[^"]*"[^>]*>/i.exec(opfContent)?.[0];
  if (coverItemTag) {
    coverHref = /href="([^"]+)"/i.exec(coverItemTag)?.[1] ?? null;
  }

  // EPUB 2: <meta name="cover" content="idDeItem"/> → buscar el item por id
  if (!coverHref) {
    const coverId =
      /<meta[^>]+name="cover"[^>]+content="([^"]+)"/i.exec(opfContent)?.[1] ??
      /<meta[^>]+content="([^"]+)"[^>]+name="cover"/i.exec(opfContent)?.[1] ??
      null;

    if (coverId) {
      const itemTag = new RegExp(`<item[^>]+id="${coverId}"[^>]*>`, 'i').exec(opfContent)?.[0];
      if (itemTag) {
        coverHref = /href="([^"]+)"/i.exec(itemTag)?.[1] ?? null;
      }
    }
  }

  return {
    title: titleMatch ? decodeXmlEntities(titleMatch[1]) || null : null,
    author: authorMatch ? decodeXmlEntities(authorMatch[1]) || null : null,
    coverHref,
  };
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

      // Metadata real del libro: título, autor y portada.
      const { title, author, coverHref } = parseOpfMetadata(opfContent);
      let coverBase64: string | null = null;
      let coverExtension: string | null = null;

      if (coverHref) {
        const coverPath = opfDir ? `${opfDir}/${coverHref}` : coverHref;
        const coverFile = zip.file(coverPath) ?? zip.file(coverHref);
        if (coverFile) {
          try {
            coverBase64 = await coverFile.async('base64');
            const rawExtension = coverHref.split('.').pop()?.toLowerCase() ?? 'jpg';
            coverExtension = `.${rawExtension === 'jpeg' ? 'jpg' : rawExtension}`;
          } catch {
            coverBase64 = null;
            coverExtension = null;
          }
        }
      }

      const metadata: DocumentMetadata = { title, author, coverBase64, coverExtension };

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
        metadata,
      };
    } catch (error) {
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el EPUB.';
      throw new DocumentParseError('parse_failed', message);
    }
  }
}

export const epubDocumentParser = new EpubDocumentParser();
