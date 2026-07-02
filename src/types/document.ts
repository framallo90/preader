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

export type ParsedDocument = {
  id: string;
  fileName: string;
  sourceUri: string;
  fullText: string;
  blocks: TextBlock[];
  chapters: ChapterInfo[];
};

export interface DocumentParser {
  parse(uri: string): Promise<ParsedDocument>;
}
