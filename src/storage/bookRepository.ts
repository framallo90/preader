import { getDatabase } from './database';
import { parsedDocumentRepository } from './parsedDocumentRepository';
import { Book, BookStatus } from '../types/storage';

type BookRow = {
  id: string;
  name: string;
  title: string | null;
  author: string | null;
  coverUri: string | null;
  summary: string | null;
  uri: string;
  type: string;
  importedAt: string;
  lastOpenedAt: string;
  status: string | null;
  favorite: number | null;
  rating: number | null;
  review: string | null;
};

// Las columnas `sagaId` y `orderIndex` siguen EXISTIENDO en la tabla (sacarlas
// obliga a reconstruirla y no aporta nada), pero ya no se leen ni se escriben:
// eran de una jerarquía saga → libro que nunca se terminó de construir. Quedan
// en NULL / 0. Si algún día se hacen las series, se arranca de ahí.
const BOOK_COLUMNS =
  'id, name, title, author, coverUri, summary, uri, type, importedAt, lastOpenedAt, status, favorite, rating, review';

function toBookStatus(value: string | null): BookStatus {
  return value === 'to_read' || value === 'read' ? value : 'none';
}

function mapBookRow(row: BookRow): Book {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    author: row.author,
    coverUri: row.coverUri,
    summary: row.summary,
    uri: row.uri,
    type: row.type,
    importedAt: row.importedAt,
    lastOpenedAt: row.lastOpenedAt,
    status: toBookStatus(row.status),
    favorite: row.favorite === 1,
    rating: typeof row.rating === 'number' && row.rating >= 1 && row.rating <= 5 ? row.rating : null,
    review: row.review,
  };
}

export const bookRepository = {
  async saveBook(book: Book): Promise<void> {
    const db = await getDatabase();
    // COALESCE en title/author/coverUri: re-importar el mismo libro
    // (mismo fingerprint) no debe pisar la metadata ya extraída. Estado,
    // favorito y reseña NO se escriben acá: son del usuario y un re-import
    // (o un re-escaneo) jamás debe resetearlos.
    await db.runAsync(
      `INSERT INTO books (id, name, title, author, coverUri, summary, uri, type, importedAt, lastOpenedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         title = COALESCE(excluded.title, title),
         author = COALESCE(excluded.author, author),
         coverUri = COALESCE(excluded.coverUri, coverUri),
         summary = COALESCE(excluded.summary, summary),
         uri = excluded.uri,
         type = excluded.type,
         lastOpenedAt = excluded.lastOpenedAt`,
      [
        book.id,
        book.name,
        book.title,
        book.author,
        book.coverUri,
        book.summary,
        book.uri,
        book.type,
        book.importedAt,
        book.lastOpenedAt,
      ],
    );
  },

  async updateBookMetadata(
    bookId: string,
    metadata: { title: string | null; author: string | null; coverUri: string | null; summary?: string | null },
  ): Promise<void> {
    const db = await getDatabase();
    // COALESCE en todo: pasar null significa "no lo toques", no "borralo".
    await db.runAsync(
      `UPDATE books SET
         title = COALESCE(?, title),
         author = COALESCE(?, author),
         coverUri = COALESCE(?, coverUri),
         summary = COALESCE(?, summary)
       WHERE id = ?`,
      [metadata.title, metadata.author, metadata.coverUri, metadata.summary ?? null, bookId],
    );
  },

  /** Resumen escrito (o borrado) por el usuario desde la ficha. */
  async setSummary(bookId: string, summary: string | null): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE books SET summary = ? WHERE id = ?', [summary, bookId]);
  },

  async setStatus(bookId: string, status: BookStatus): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE books SET status = ? WHERE id = ?', [status, bookId]);
  },

  async setFavorite(bookId: string, favorite: boolean): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE books SET favorite = ? WHERE id = ?', [favorite ? 1 : 0, bookId]);
  },

  async setReview(bookId: string, rating: number | null, review: string | null): Promise<void> {
    const db = await getDatabase();
    const trimmed = review?.trim() ?? '';
    await db.runAsync('UPDATE books SET rating = ?, review = ? WHERE id = ?', [
      rating,
      trimmed.length > 0 ? trimmed : null,
      bookId,
    ]);
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

  /**
   * El último libro que ABRISTE, para la tarjeta "Seguir leyendo", o null si
   * todavía no abriste ninguno.
   *
   * Un libro que entra por escaneo guarda `lastOpenedAt` igual a `importedAt`;
   * recién al abrirlo `touchBook` lo adelanta. Sin esa condición, escanear una
   * carpeta ponía en "Seguir leyendo" un libro que nunca tocaste (y con 95
   * libros nuevos, uno cualquiera de ellos).
   *
   * Devuelve null a propósito cuando no abriste nada: el Inicio no dibuja la
   * tarjeta y la biblioteca queda arriba de todo. Acá había un respaldo que en
   * ese caso agarraba "el más reciente", y era justo el mismo bug: después de
   * una instalación limpia te ofrecía continuar un cómic que nunca abriste.
   */
  async getLastOpenedBook(): Promise<Book | null> {
    const db = await getDatabase();
    const opened = await db.getFirstAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS}
       FROM books WHERE lastOpenedAt > importedAt ORDER BY lastOpenedAt DESC LIMIT 1`,
    );
    return opened ? mapBookRow(opened) : null;
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

  /** Toda la biblioteca (la pantalla de inicio filtra y agrupa en memoria). */
  /** Todos los URIs de la biblioteca (para que el escaneo salte lo ya conocido). */
  async listBookUris(): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ uri: string }>('SELECT uri FROM books');
    return rows.map((row) => row.uri);
  },

  /** Porcentaje leído por libro, en una sola consulta (antes era una por libro). */
  async listProgressPercentages(): Promise<Map<string, number>> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ bookId: string; percentage: number | null }>(
      'SELECT bookId, percentage FROM reading_progress WHERE percentage > 0',
    );
    return new Map(rows.map((row) => [row.bookId, row.percentage ?? 0]));
  },

  async listAllBooks(): Promise<Book[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<BookRow>(
      `SELECT ${BOOK_COLUMNS} FROM books ORDER BY datetime(lastOpenedAt) DESC`,
    );
    return rows.map(mapBookRow);
  },


  async removeBook(bookId: string): Promise<void> {
    const db = await getDatabase();
    // reading_progress no tiene FK, así que se borra a mano. Capítulos, notas y
    // vínculos con colecciones se van por ON DELETE CASCADE.
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM reading_progress WHERE bookId = ?', [bookId]);
      await db.runAsync('DELETE FROM books WHERE id = ?', [bookId]);
    });
    // El caché parseado toca archivos en disco → fuera de la transacción SQLite.
    await parsedDocumentRepository.removeParsedDocument(bookId);
  },
};
