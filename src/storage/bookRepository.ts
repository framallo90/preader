import { getDatabase } from './database';
import { Book } from '../types/storage';

type BookRow = {
  id: string;
  sagaId: string | null;
  name: string;
  orderIndex: number;
  uri: string;
  type: string;
  importedAt: string;
  lastOpenedAt: string;
};

function mapBookRow(row: BookRow): Book {
  return {
    id: row.id,
    sagaId: row.sagaId,
    name: row.name,
    orderIndex: row.orderIndex,
    uri: row.uri,
    type: row.type,
    importedAt: row.importedAt,
    lastOpenedAt: row.lastOpenedAt,
  };
}

export const bookRepository = {
  async saveBook(book: Book): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO books (id, sagaId, name, orderIndex, uri, type, importedAt, lastOpenedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sagaId = excluded.sagaId,
         name = excluded.name,
         orderIndex = excluded.orderIndex,
         uri = excluded.uri,
         type = excluded.type,
         importedAt = excluded.importedAt,
         lastOpenedAt = excluded.lastOpenedAt`,
      [
        book.id,
        book.sagaId,
        book.name,
        book.orderIndex,
        book.uri,
        book.type,
        book.importedAt,
        book.lastOpenedAt,
      ],
    );
  },

  async touchBook(bookId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE books SET lastOpenedAt = ? WHERE id = ?',
      [new Date().toISOString(), bookId],
    );
  },

  async getBookById(bookId: string): Promise<Book | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<BookRow>(
      'SELECT id, sagaId, name, orderIndex, uri, type, importedAt, lastOpenedAt FROM books WHERE id = ?',
      [bookId],
    );
    return row ? mapBookRow(row) : null;
  },

  async getLastOpenedBook(): Promise<Book | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<BookRow>(
      `SELECT id, sagaId, name, orderIndex, uri, type, importedAt, lastOpenedAt
       FROM books ORDER BY datetime(lastOpenedAt) DESC LIMIT 1`,
    );
    return row ? mapBookRow(row) : null;
  },

  async listRecentBooks(limit = 20): Promise<Book[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BookRow>(
      `SELECT id, sagaId, name, orderIndex, uri, type, importedAt, lastOpenedAt
       FROM books ORDER BY datetime(lastOpenedAt) DESC LIMIT ?`,
      [limit],
    );
    return rows.map(mapBookRow);
  },

  async listBooksInSaga(sagaId: string): Promise<Book[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BookRow>(
      `SELECT id, sagaId, name, orderIndex, uri, type, importedAt, lastOpenedAt
       FROM books WHERE sagaId = ? ORDER BY orderIndex ASC`,
      [sagaId],
    );
    return rows.map(mapBookRow);
  },

  async removeBook(bookId: string): Promise<void> {
    const db = await getDatabase();
    // CASCADE elimina chapters; reading_progress y parsed_document_cache
    // no tienen FK, así que se limpian explícitamente para no dejar huérfanos.
    await db.runAsync('DELETE FROM reading_progress WHERE bookId = ?', [bookId]);
    await db.runAsync('DELETE FROM parsed_document_cache WHERE bookId = ?', [bookId]);
    await db.runAsync('DELETE FROM books WHERE id = ?', [bookId]);
  },
};
