export type TextBlock = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export type ChapterInfo = {
  id: string;
  title: string;
  povCharacter: string | null;
  povNumber: number | null;
  orderIndex: number;
  startChar: number;
  endChar: number;
};

/** Metadata extraída del archivo (no del nombre): título, autor y portada. */
export type DocumentMetadata = {
  title: string | null;
  author: string | null;
  /** Imagen de portada en base64, lista para persistir como archivo local. */
  coverBase64: string | null;
  /** Extensión de la portada ('.jpg', '.png') si coverBase64 está presente. */
  coverExtension: string | null;
};

/** Datos del lector visual de un PDF (páginas reales dibujadas en el teléfono). */
export type PdfPageInfo = {
  pageCount: number;
  /** ancho/alto de la página sin recortar; null si no se pudo medir. */
  pageAspect: number | null;
  /** Dónde empieza cada página dentro de fullText (mapeo exacto voz↔página). */
  pageOffsets: number[];
  /** Caja de contenido [left, top, right, bottom] en 0..1, o null sin recorte. */
  crop: [number, number, number, number] | null;
  /** Índice real del documento; vacío si el PDF no trae. */
  outline: Array<{ title: string; pageIndex: number; level: number }>;
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

