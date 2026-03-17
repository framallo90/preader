import { getDatabase } from './database';
import { StoredDocument } from '../types/storage';

type DocumentRow = {
  id: string;
  name: string;
  uri: string;
  type: string | null;
  importedAt: string;
  lastOpenedAt: string;
};

function mapDocumentRow(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    name: row.name,
    uri: row.uri,
    type: row.type,
    importedAt: row.importedAt,
    lastOpenedAt: row.lastOpenedAt,
  };
}

export const recentFilesRepository = {
  async saveDocument(document: StoredDocument) {
    const db = await getDatabase();

    await db.runAsync(
      `
        INSERT INTO documents (id, name, uri, type, importedAt, lastOpenedAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          uri = excluded.uri,
          type = excluded.type,
          importedAt = excluded.importedAt,
          lastOpenedAt = excluded.lastOpenedAt
      `,
      [
        document.id,
        document.name,
        document.uri,
        document.type,
        document.importedAt,
        document.lastOpenedAt,
      ],
    );
  },

  async touchDocument(documentId: string) {
    const db = await getDatabase();

    await db.runAsync(
      `
        UPDATE documents
        SET lastOpenedAt = ?
        WHERE id = ?
      `,
      [new Date().toISOString(), documentId],
    );
  },

  async removeDocument(documentId: string) {
    const db = await getDatabase();

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM reading_progress WHERE documentId = ?', [documentId]);
      await db.runAsync('DELETE FROM parsed_document_cache WHERE documentId = ?', [documentId]);
      await db.runAsync('DELETE FROM documents WHERE id = ?', [documentId]);
    });
  },

  async getDocumentById(documentId: string) {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DocumentRow>(
      `
        SELECT id, name, uri, type, importedAt, lastOpenedAt
        FROM documents
        WHERE id = ?
      `,
      [documentId],
    );

    return row ? mapDocumentRow(row) : null;
  },

  async getLastOpenedDocument() {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DocumentRow>(
      `
        SELECT id, name, uri, type, importedAt, lastOpenedAt
        FROM documents
        ORDER BY datetime(lastOpenedAt) DESC
        LIMIT 1
      `,
    );

    return row ? mapDocumentRow(row) : null;
  },

  async listRecentDocuments(limit = 8) {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DocumentRow>(
      `
        SELECT id, name, uri, type, importedAt, lastOpenedAt
        FROM documents
        ORDER BY datetime(lastOpenedAt) DESC
        LIMIT ?
      `,
      [limit],
    );

    return rows.map(mapDocumentRow);
  },
};
