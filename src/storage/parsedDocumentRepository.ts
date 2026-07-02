import { ParsedDocument, TextBlock } from '../types/document';
import { getDatabase } from './database';

// Acepta tanto Book como StoredDocument (ambos tienen id, name, uri)
export type DocumentRef = { id: string; name: string; uri: string };

type ParsedDocumentRow = {
  bookId: string;
  fullText: string;
  blocksJson: string;
  chaptersJson: string;
  savedAt: string;
};

const MAX_CACHEABLE_TEXT_LENGTH = 500_000;
const MAX_CACHEABLE_BLOCKS = 4_000;
const MAX_CACHEABLE_BLOCKS_JSON_LENGTH = 900_000;

function isTextBlock(value: unknown): value is TextBlock {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const block = value as Record<string, unknown>;

  return (
    typeof block.index === 'number' &&
    typeof block.text === 'string' &&
    typeof block.startChar === 'number' &&
    typeof block.endChar === 'number'
  );
}

function parseBlocksJson(value: string): TextBlock[] {
  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isTextBlock);
  } catch {
    return [];
  }
}

export const parsedDocumentRepository = {
  async getParsedDocument(document: DocumentRef): Promise<ParsedDocument | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ParsedDocumentRow>(
      `SELECT bookId, fullText, blocksJson, chaptersJson, savedAt
       FROM parsed_document_cache WHERE bookId = ?`,
      [document.id],
    );

    if (!row) {
      return null;
    }

    const blocks = parseBlocksJson(row.blocksJson);

    if (!row.fullText.trim() || blocks.length === 0) {
      return null;
    }

    // chapters se re-detectan en reader.tsx con el bookId correcto;
    // los devolvemos vacíos para que el caller siempre llame a detectChapters.
    return {
      id: document.id,
      fileName: document.name,
      sourceUri: document.uri,
      fullText: row.fullText,
      blocks,
      chapters: [],
    };
  },

  async saveParsedDocument(document: DocumentRef, parsedDocument: ParsedDocument) {
    if (
      parsedDocument.fullText.length > MAX_CACHEABLE_TEXT_LENGTH ||
      parsedDocument.blocks.length > MAX_CACHEABLE_BLOCKS
    ) {
      return;
    }

    const blocksJson = JSON.stringify(parsedDocument.blocks);

    if (blocksJson.length > MAX_CACHEABLE_BLOCKS_JSON_LENGTH) {
      return;
    }

    const chaptersJson = JSON.stringify(parsedDocument.chapters ?? []);
    const db = await getDatabase();

    await db.runAsync(
      `INSERT INTO parsed_document_cache (bookId, fullText, blocksJson, chaptersJson, savedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bookId) DO UPDATE SET
         fullText = excluded.fullText,
         blocksJson = excluded.blocksJson,
         chaptersJson = excluded.chaptersJson,
         savedAt = excluded.savedAt`,
      [document.id, parsedDocument.fullText, blocksJson, chaptersJson, new Date().toISOString()],
    );
  },

  async removeParsedDocument(documentId: string) {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM parsed_document_cache WHERE bookId = ?', [documentId]);
  },
};
