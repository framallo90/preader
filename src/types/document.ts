export type TextBlock = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export type ChapterInfo = {
  id: string;
  title: string;
  orderIndex: number;
  startChar: number;
  endChar: number;
};

/** Metadata extraída del archivo (no del nombre): título, autor y portada. */
export type DocumentMetadata = {
  title: string | null;
  author: string | null;
  /** Sinopsis que trae el archivo (EPUB, DOCX y PDF la declaran). */
  summary?: string | null;
  /** Imagen de portada en base64, lista para persistir como archivo local. */
  coverBase64: string | null;
  /** Extensión de la portada ('.jpg', '.png') si hay portada. */
  coverExtension: string | null;
  /** Portada ya extraída a un archivo temporal (lectura nativa), en vez de base64. */
  coverFileUri?: string | null;
};

/**
 * Datos del lector visual por páginas: un PDF (páginas dibujadas en el teléfono) o
 * un cómic (cada página es una imagen del archivo).
 */
export type PdfPageInfo = {
  /** 'comic': CBZ/CBR/CB7/CBT. Ausente = PDF. */
  kind?: 'pdf' | 'comic';
  /**
   * true mientras el texto se prepara de fondo: las páginas ya se leen, pero la voz
   * y la búsqueda todavía no. Un documento así nunca se guarda en el caché.
   */
  textPending?: boolean;
  pageCount: number;
  /** ancho/alto de la página sin recortar; null si no se pudo medir. */
  pageAspect: number | null;
  /** Dónde empieza cada página dentro de fullText (mapeo exacto voz↔página). */
  pageOffsets: number[];
  /** Caja de contenido [left, top, right, bottom] en 0..1, o null sin recorte. */
  crop: [number, number, number, number] | null;
  /** Índice real del documento; vacío si el PDF no trae. */
  outline: { title: string; pageIndex: number; level: number }[];
  /** false en PDFs escaneados: se leen las páginas, pero no hay texto para la voz. */
  hasText: boolean;
};

/** Entrada del índice del libro ya ubicada en el texto (EPUB). */
export type TocEntry = {
  title: string;
  startChar: number;
  /** 0 = nivel superior. */
  level: number;
};

export type ParsedDocument = {
  id: string;
  fileName: string;
  sourceUri: string;
  fullText: string;
  blocks: TextBlock[];
  chapters: ChapterInfo[];
  /** Solo en PDFs. */
  pdf?: PdfPageInfo;
  /** Índice real del libro, cuando el formato lo trae ubicable en el texto (EPUB). */
  toc?: TocEntry[];
  /** Presente solo en el parseo fresco; no se incluye en el cache SQLite. */
  metadata?: DocumentMetadata;
};

export interface DocumentParser {
  parse(uri: string, onProgress?: (done: number, total: number) => void): Promise<ParsedDocument>;
}

