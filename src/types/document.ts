export type TextBlock = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export type ParsedDocument = {
  id: string;
  fileName: string;
  sourceUri: string;
  fullText: string;
  blocks: TextBlock[];
};

export interface DocumentParser {
  parse(uri: string): Promise<ParsedDocument>;
}
