import { getDatabase } from './database';
import { parsedDocumentRepository } from './parsedDocumentRepository';
import { Book } from '../types/storage';

type BookRow = {
  id: string;
  sagaId: string | null;
  name: string;
  title: string | null;
  author: string | null;
  coverUri: string | null;
  orderIndex: number;
  uri: string;
  type: string;
  importedAt: string;
  lastOpenedAt: string;
};

const BOOK_COLUMNS = 'id, sagaId, name, title, author, coverUri, orderIndex, uri, type, importedAt, lastOpenedAt';

function mapBookRow(row: BookRow): Book {
  return {
    id: row.id,
    sagaId: row.sagaId,
    name: row.name,
    title: row.title,
    author: row.author,
    coverUri: row.coverUri,
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
    // COALESCE en title/author/coverUri: re-importar el mismo libro
    // (mismo fingerprint) no debe pisar la metadata ya extraída.
    await db.runAsync(
      `INSERT INTO books (id, sagaId, name, title, author, coverUri, orderIndex, uri, type, importedAt, lastOpenedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sagaId = excluded.sagaId,
         name = excluded.name,
         title = COALESCE(excluded.title, title),
         author = COALESCE(excluded.author, author),
         coverUri = COALESCE(excluded.coverUri, coverUri),
         orderIndex = excluded.orderIndex,
         uri = excluded.uri,
         type = excluded.type,
         lastOpenedAt = excluded.lastOpenedAt`,
      [
        book.id,
        book.sagaId,
        book.name,
        book.title,
        book.author,
        book.coverUri,
        book.orderIndex,
        book.uri,
        book.type,
        book.importedAt,
        book.lastOpenedAt,
      ],
    );
  },

  async updateBookMetadata(
    bookId: string,
    metadata: { title: string | null; author: string | null; coverUri: string | null },
  ): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE books SET
         title = COALESCE(?, title),
         author = COALESCE(?, author),
         coverUri = COALESCE(?, coverUri)
       WHERE id = ?`,
      [metadata.title, metadata.author, metadata.coverUri, bookId],
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
      `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`,
      [bookId],
    );
    return row ? mapBookRow(row) : null;
  },

  async getBookByUri(uri: string): Promise<Book | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS} FROM books WHERE uri = ?`,
      [uri],
    );
    return row ? mapBookRow(row) : null;
  },

  async getLastOpenedBook(): Promise<Book | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS}
       FROM books ORDER BY datetime(lastOpenedAt) DESC LIMIT 1`,
    );
    return row ? mapBookRow(row) : null;
  },

  async listRecentBooks(limit = 20): Promise<Book[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS}
       FROM books ORDER BY datetime(lastOpenedAt) DESC LIMIT ?`,
      [limit],
    );
    return rows.map(mapBookRow);
  },

  async listBooksInSaga(sagaId: string): Promise<Book[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS}
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
    // Limpia el caché parseado en SQLite y sus archivos en disco (libros grandes).
    await parsedDocumentRepository.removeParsedDocument(bookId);
    await db.runAsync('DELETE FROM books WHERE id = ?', [bookId]);
  },
};
