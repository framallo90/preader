import { ParsedDocument, TextBlock } from '../types/document';
import { StoredDocument } from '../types/storage';
import { getDatabase } from './database';

type ParsedDocumentRow = {
  documentId: string;
  fullText: string;
  blocksJson: string;
  updatedAt: string;
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

function parseBlocksJson(value: string) {
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
  async getParsedDocument(document: StoredDocument): Promise<ParsedDocument | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ParsedDocumentRow>(
      `
        SELECT documentId, fullText, blocksJson, updatedAt
        FROM parsed_document_cache
        WHERE documentId = ?
      `,
      [document.id],
    );

    if (!row) {
      return null;
    }

    const blocks = parseBlocksJson(row.blocksJson);

    if (!row.fullText.trim() || blocks.length === 0) {
      return null;
    }

    return {
      id: document.id,
      fileName: document.name,
      sourceUri: document.uri,
      fullText: row.fullText,
      blocks,
    };
  },

  async saveParsedDocument(document: StoredDocument, parsedDocument: ParsedDocument) {
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

    const db = await getDatabase();

    await db.runAsync(
      `
        INSERT INTO parsed_document_cache (documentId, fullText, blocksJson, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(documentId) DO UPDATE SET
          fullText = excluded.fullText,
          blocksJson = excluded.blocksJson,
          updatedAt = excluded.updatedAt
      `,
      [
        document.id,
        parsedDocument.fullText,
        blocksJson,
        new Date().toISOString(),
      ],
    );
  },

  async removeParsedDocument(documentId: string) {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM parsed_document_cache WHERE documentId = ?', [documentId]);
  },
};
