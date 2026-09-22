import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

import { EpubFileText, getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';
import { DocumentMetadata, DocumentParser, ParsedDocument, TocEntry } from '../types/document';
import {
  EpubTocEntry,
  decodeEntities,
  findTocPaths,
  htmlToText,
  indexAnchors,
  parseAttributes,
  parseManifest,
  parseNav,
  parseNcx,
  parseSpinePaths,
  resolveEpubPath,
  titleProbe,
} from '../utils/epubStructure';
import { buildAutoSummary, cleanMetadataSummary } from '../utils/bookSummary';
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
function parseOpfMetadata(opf: string): {
  title: string | null;
  author: string | null;
  summary: string | null;
  coverHref: string | null;
} {
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1];
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1];
  // La sinopsis del EPUB suele venir con HTML adentro; se limpia al usarla.
  const description = /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i.exec(opf)?.[1];
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
  return {
    title: clean(title),
    author: clean(author),
    summary: cleanMetadataSummary(description ? decodeEntities(description) : null),
    coverHref,
  };
}

type EpubCover = Pick<DocumentMetadata, 'coverBase64' | 'coverExtension' | 'coverFileUri'>;
const NO_COVER: EpubCover = { coverBase64: null, coverExtension: null, coverFileUri: null };
const PARAGRAPH_BREAK = '\n\n';

/** De dónde se leen las entradas del EPUB (que es un zip). */
interface EpubSource {
  /** Entradas tal cual (container.xml, OPF, nav, NCX). */
  texts(paths: string[]): Promise<(string | null)[]>;
  /** Capítulos ya como texto plano normalizado, con la posición de cada ancla. */
  chapters(paths: string[]): Promise<(EpubFileText | null)[]>;
  cover(path: string, extension: string): Promise<EpubCover>;
}

/**
 * Texto de un capítulo a partir de su XHTML, en JavaScript (solo para la vía de
 * respaldo). Las anclas se ubican avanzando de una a la siguiente y convirtiendo
 * el tramo intermedio: lineal en el tamaño del archivo.
 */
function convertChapterInJs(html: string): EpubFileText {
  const text = normalizeExtractedText(htmlToText(html));
  const anchors: Record<string, number> = {};
  const sorted = [...indexAnchors(html)].sort((a, b) => a[1] - b[1]);
  let previousAt = 0;
  let estimate = 0;
  for (const [id, at] of sorted) {
    if (at > previousAt) {
      const segment = normalizeExtractedText(htmlToText(html.slice(previousAt, at)));
      if (segment) estimate += segment.length + 2; // + el salto de párrafo
      previousAt = at;
    }
    anchors[id] = Math.min(estimate, text.length);
  }
  return { text, anchors };
}

/**
 * Lectura nativa: cada XHTML se descomprime en el teléfono y llega como texto.
 * La vía anterior (JSZip) pasaba el archivo ENTERO por base64 a JavaScript y lo
 * descomprimía ahí: con un EPUB con imágenes eran decenas de MB y varios segundos
 * —o minutos— antes de mostrar la primera línea.
 */
function nativeSource(uri: string): EpubSource {
  const archive = getBardoArchiveModule();
  return {
    texts: (paths) => archive.readTextAsync(uri, paths),
    // La conversión HTML → texto y la ubicación de las anclas se hacen en el
    // teléfono, en una pasada: en JavaScript eran 17 pasadas de regex por archivo.
    chapters: (paths) => archive.readEpubTextsAsync(uri, paths),
    async cover(path, extension) {
      if (!FileSystem.cacheDirectory) return NO_COVER;
      try {
        const target = `${FileSystem.cacheDirectory}epub-cover-${Date.now()}${extension}`;
        const coverFileUri = await archive.extractEntryAsync(uri, path, target);
        return coverFileUri ? { coverBase64: null, coverExtension: extension, coverFileUri } : NO_COVER;
      } catch {
        return NO_COVER;
      }
    },
  };
}

/** Plan B (build sin el módulo nativo): todo en JavaScript, como antes. */
async function jsZipSource(uri: string): Promise<EpubSource> {
  // Carga el EPUB entero en RAM: guard de memoria antes de leer.
  await assertFileSizeWithinLimit(uri);
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  return {
    texts: (paths) => Promise.all(paths.map(async (path) => (await zip.file(path)?.async('string')) ?? null)),
    chapters: (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const html = await zip.file(path)?.async('string');
          return html ? convertChapterInJs(html) : null;
        }),
      ),
    async cover(path, extension) {
      try {
        const coverBase64 = (await zip.file(path)?.async('base64')) ?? null;
        return coverBase64 ? { coverBase64, coverExtension: extension, coverFileUri: null } : NO_COVER;
      } catch {
        return NO_COVER;
      }
    },
  };
}

// Los capítulos se piden de a tandas: una sola llamada con todo el libro armaría
// un único mensaje enorme entre el lado nativo y JavaScript.
const SPINE_BATCH = 40;

class EpubDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    const fileInfo = await FileSystem.getInfoAsync(uri);

    if (!fileInfo.exists) {
      throw new DocumentParseError('missing_file', 'El archivo ya no existe en el almacenamiento local.');
    }

    try {
      const source = isBardoArchiveAvailable() ? nativeSource(uri) : await jsZipSource(uri);

      const [containerXml] = await source.texts(['META-INF/container.xml']);
      if (!containerXml) {
        throw new DocumentParseError('parse_failed', 'El EPUB no tiene un container.xml válido.');
      }

      const opfPath = /full-path\s*=\s*["']([^"']+\.opf)["']/i.exec(containerXml)?.[1];
      if (!opfPath) {
        throw new DocumentParseError('parse_failed', 'No se encontró el archivo OPF en el EPUB.');
      }

      const opfDir = directoryOf(opfPath);
      const [opf] = await source.texts([opfPath]);
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
      const fileAnchors = new Map<string, Record<string, number>>();

      const parts: string[] = [];
      let length = 0;
      for (let from = 0; from < spinePaths.length; from += SPINE_BATCH) {
        const batch = spinePaths.slice(from, from + SPINE_BATCH);
        const chapters = await source.chapters(batch);
        batch.forEach((path, index) => {
          const chapter = chapters[index];
          if (!chapter || !chapter.text) return;
          if (length > 0) {
            parts.push(PARAGRAPH_BREAK);
            length += PARAGRAPH_BREAK.length;
          }
          fileStart.set(path, length);
          fileAnchors.set(path, chapter.anchors);
          parts.push(chapter.text);
          length += chapter.text.length;
        });
      }
      fullText = parts.join('');

      if (!fullText) {
        throw new DocumentParseError('no_extractable_text', 'El EPUB no contiene texto legible.');
      }

      const blocks = buildTextBlocks(fullText);
      if (blocks.length === 0) {
        throw new DocumentParseError('empty_document', 'No se pudieron construir bloques legibles.');
      }

      const toc = await this.readToc(source, opf, opfDir, fullText, fileStart, fileAnchors);
      const metadata = await this.readMetadata(source, opf, opfDir);

      const fileName = uri.split('/').pop() ?? 'documento.epub';
      const documentId = fileName;

      return {
        id: documentId,
        fileName,
        sourceUri: uri,
        fullText,
        blocks,
        chapters: [], // los resuelve el lector: índice real si hay, si no detección
        toc: toc.length > 0 ? toc : undefined,
        // Si el EPUB no declara sinopsis, se arma con las primeras líneas.
        metadata: { ...metadata, summary: metadata.summary ?? buildAutoSummary(fullText) },
      };
    } catch (error) {
      if (error instanceof DocumentParseError) throw error;

      const message = error instanceof Error ? error.message : 'No se pudo leer el EPUB.';
      throw new DocumentParseError('parse_failed', message);
    }
  }

  /** Índice del libro (nav de EPUB 3 o NCX de EPUB 2) ubicado en el texto. Nunca lanza. */
  private async readToc(
    source: EpubSource,
    opf: string,
    opfDir: string,
    fullText: string,
    fileStart: Map<string, number>,
    fileAnchors: Map<string, Record<string, number>>,
  ): Promise<TocEntry[]> {
    try {
      const { nav, ncx } = findTocPaths(opf, opfDir);
      let entries: EpubTocEntry[] = [];
      if (nav) {
        const [content] = await source.texts([nav]);
        if (content) entries = parseNav(content, directoryOf(nav));
      }
      if (entries.length < 2 && ncx) {
        const [content] = await source.texts([ncx]);
        if (content) entries = parseNcx(content, directoryOf(ncx));
      }

      // Cada ancla ya viene con su posición dentro del texto del archivo (la
      // calculó el conversor al pasar el HTML a texto). Solo queda el ajuste fino:
      // el título suele estar escrito en el texto, cerca de esa posición.
      const located: { order: number; item: TocEntry }[] = [];
      entries.slice(0, MAX_TOC_ENTRIES).forEach((entry, order) => {
        const start = fileStart.get(entry.file);
        if (start === undefined) return;
        const anchors = fileAnchors.get(entry.file) ?? {};
        const within = entry.anchor ? anchors[entry.anchor] ?? 0 : 0;
        let offset = Math.min(start + within, fullText.length - 1);
        const probe = titleProbe(entry.title);
        if (probe) {
          const from = Math.max(start, offset - 600);
          const match = probe.exec(fullText.slice(from, offset + 600));
          if (match) offset = from + match.index;
        }
        while (offset < fullText.length - 1 && /\s/.test(fullText[offset])) offset += 1;
        located.push({ order, item: { title: entry.title, startChar: offset, level: entry.level } });
      });

      const toc = located.sort((a, b) => a.order - b.order).map((entry) => entry.item);
      return toc;
    } catch {
      return []; // un índice ilegible no debe frenar la apertura
    }
  }

  private async readMetadata(source: EpubSource, opf: string, opfDir: string): Promise<DocumentMetadata> {
    const { title, author, summary, coverHref } = parseOpfMetadata(opf);
    if (!coverHref) return { title, author, summary, ...NO_COVER };

    const rawExtension = coverHref.split('#')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
    const extension = `.${rawExtension === 'jpeg' ? 'jpg' : rawExtension}`;
    let cover = await source.cover(resolveEpubPath(opfDir, coverHref), extension);
    if (!cover.coverBase64 && !cover.coverFileUri) cover = await source.cover(coverHref, extension);
    return { title, author, summary, ...cover };
  }
}

export const epubDocumentParser = new EpubDocumentParser();
