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

export type ParsedDocument = {
  id: string;
  fileName: string;
  sourceUri: string;
  fullText: string;
  blocks: TextBlock[];
  chapters: ChapterInfo[];
  /** Presente solo en el parseo fresco; no se incluye en el cache SQLite. */
  metadata?: DocumentMetadata;
};

export interface DocumentParser {
  parse(uri: string): Promise<ParsedDocument>;
}

