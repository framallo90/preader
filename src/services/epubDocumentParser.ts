import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

import { DocumentMetadata, DocumentParser, ParsedDocument, TocEntry } from '../types/document';
import { detectChapters } from '../utils/chapterDetector';
import {
  EpubTocEntry,
  decodeEntities,
  findAnchorIndex,
  findTocPaths,
  htmlToText,
  parseAttributes,
  parseManifest,
  parseNav,
  parseNcx,
  parseSpinePaths,
  resolveEpubPath,
} from '../utils/epubStructure';
import { buildTextBlocks, normalizeExtractedText } from '../utils/textBlocks';
import { DocumentParseError, assertFileSizeWithinLimit } from './documentParser';

const MAX_TOC_ENTRIES = 800;

function directoryOf(path: string): string {
  return path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
}

/**
 * Título, autor y portada desde el OPF.
 * Soporta EPUB 3 (item properties="cover-image") y EPUB 2 (meta name="cover").
 */
function parseOpfMetadata(opf: string): { title: string | null; author: string | null; coverHref: string | null } {
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1];
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1];
  const manifest = parseManifest(opf);

  let coverHref: string | null = null;
  for (const item of manifest.values()) {
    if (item.properties?.split(/\s+/).includes('cover-image')) {
      coverHref = item.href;
      break;
    }
  }
  if (!coverHref) {
    for (const match of opf.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = parseAttributes(match[0]);
      if (attrs.name === 'cover' && attrs.content) {
        coverHref = manifest.get(attrs.content)?.href ?? null;
        break;
      }
    }
  }

  const clean = (value: string | undefined) => (value ? decodeEntities(value.replace(/<[^>]+>/g, '')).trim() || null : null);
  return { title: clean(title), author: clean(author), coverHref };
}

class EpubDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }
    // El parseo carga el EPUB entero en RAM: guard de memoria antes de leer.
    await assertFileSizeWithinLimit(uri);

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const zip = await JSZip.loadAsync(base64, { base64: true });

      const containerXml = await zip.file('META-INF/container.xml')?.async('string');
      if (!containerXml) {
        throw new DocumentParseError('parse_failed', 'El EPUB no tiene un container.xml válido.');
      }

      const opfPath = /full-path\s*=\s*["']([^"']+\.opf)["']/i.exec(containerXml)?.[1];
      if (!opfPath) {
        throw new DocumentParseError('parse_failed', 'No se encontró el archivo OPF en el EPUB.');
      }

      const opfDir = directoryOf(opfPath);
      const opf = await zip.file(opfPath)?.async('string');
      if (!opf) {
        throw new DocumentParseError('parse_failed', 'No se pudo leer el archivo OPF del EPUB.');
      }

      const spinePaths = parseSpinePaths(opf, opfDir);
      if (spinePaths.length === 0) {
        throw new DocumentParseError('parse_failed', 'El EPUB no tiene contenido en el spine.');
      }

      // Texto por archivo, en orden de lectura. Se recuerda dónde empieza cada
      // archivo dentro del texto y su HTML, para poder ubicar el índice después.
      let fullText = '';
      const fileStart = new Map<string, number>();
      const fileHtml = new Map<string, string>();

      for (const path of spinePaths) {
        const file = zip.file(path);
        if (!file) continue;
        const html = await file.async('string');
        const text = normalizeExtractedText(htmlToText(html));
        if (!text) continue;
        if (fullText) fullText += '\n\n';
        fileStart.set(path, fullText.length);
        fileHtml.set(path, html);
        fullText += text;
      }

      if (!fullText) {
        throw new DocumentParseError('no_extractable_text', 'El EPUB no contiene texto legible.');
      }

      const blocks = buildTextBlocks(fullText);
      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      const toc = await this.readToc(zip, opf, opfDir, fullText, fileStart, fileHtml);
      const metadata = await this.readMetadata(zip, opf, opfDir);

      const fileName = uri.split('/').pop() ?? 'documento.epub';
      const documentId = fileName;

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters: detectChapters(documentId, fullText),
        toc: toc.length > 0 ? toc : undefined,
        metadata,
      };
    } catch (error) {
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el EPUB.';
      throw new DocumentParseError('parse_failed', message);
    }
  }

  /** Índice del libro (nav de EPUB 3 o NCX de EPUB 2) ubicado en el texto. Nunca lanza. */
  private async readToc(
    zip: JSZip,
    opf: string,
    opfDir: string,
    fullText: string,
    fileStart: Map<string, number>,
    fileHtml: Map<string, string>,
  ): Promise<TocEntry[]> {
    try {
      const { nav, ncx } = findTocPaths(opf, opfDir);
      let entries: EpubTocEntry[] = [];
      if (nav) {
        const content = await zip.file(nav)?.async('string');
        if (content) entries = parseNav(content, directoryOf(nav));
      }
      if (entries.length < 2 && ncx) {
        const content = await zip.file(ncx)?.async('string');
        if (content) entries = parseNcx(content, directoryOf(ncx));
      }

      const toc: TocEntry[] = [];
      for (const entry of entries.slice(0, MAX_TOC_ENTRIES)) {
        const start = fileStart.get(entry.file);
        const html = fileHtml.get(entry.file);
        if (start === undefined || !html) continue;

        let offset = start;
        if (entry.anchor) {
          const anchorIndex = findAnchorIndex(html, entry.anchor);
          if (anchorIndex > 0) {
            // Largo del texto que hay ANTES del ancla, con la misma limpieza.
            offset = start + normalizeExtractedText(htmlToText(html.slice(0, anchorIndex))).length;
          }
        }
        // El corte puede caer en el espacio previo al título: se avanza a la letra.
        while (offset < fullText.length && /\s/.test(fullText[offset])) offset += 1;
        toc.push({ title: entry.title, startChar: Math.min(offset, fullText.length - 1), level: entry.level });
      }
      return toc;
    } catch {
      return []; // un índice ilegible no debe frenar la apertura
    }
  }

  private async readMetadata(zip: JSZip, opf: string, opfDir: string): Promise<DocumentMetadata> {
    const { title, author, coverHref } = parseOpfMetadata(opf);
    let coverBase64: string | null = null;
    let coverExtension: string | null = null;

    if (coverHref) {
      const coverFile = zip.file(resolveEpubPath(opfDir, coverHref)) ?? zip.file(coverHref);
      if (coverFile) {
        try {
          coverBase64 = await coverFile.async('base64');
          const rawExtension = coverHref.split('#')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
          coverExtension = `.${rawExtension === 'jpeg' ? 'jpg' : rawExtension}`;
        } catch {
          coverBase64 = null;
          coverExtension = null;
        }
      }
    }

    return { title, author, coverBase64, coverExtension };
  }
}

export const epubDocumentParser = new EpubDocumentParser();
