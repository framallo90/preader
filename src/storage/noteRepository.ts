import { getDatabase } from './database';
import { BookNote, NoteType } from '../types/storage';

type NoteRow = {
  id: string;
  bookId: string;
  type: string;
  charIndex: number;
  page: number | null;
  body: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

const NOTE_COLUMNS = 'id, bookId, type, charIndex, page, body, comment, createdAt, updatedAt';

/** Una nota con lo justo del libro para mostrarla fuera de su ficha. */
export type NoteWithBook = BookNote & { bookTitle: string | null; bookName: string; bookAuthor: string | null };
const NOTE_TYPES: NoteType[] = ['bookmark', 'quote', 'note'];

function mapNoteRow(row: NoteRow): BookNote {
  return {
    id: row.id,
    bookId: row.bookId,
    type: NOTE_TYPES.includes(row.type as NoteType) ? (row.type as NoteType) : 'note',
    charIndex: row.charIndex,
    page: row.page,
    body: row.body,
    comment: row.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createNoteId(): string {
  return `nt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Marcadores, citas y notas en UNA tabla, distinguidos por `type` (el mismo
 * modelo que usa ReadEra): así la pantalla del libro los lista juntos, en orden
 * de aparición, sin uniones.
 *
 * La posición es el offset de carácter en el texto del libro — la misma unidad
 * que usan el progreso y la voz — más la página, solo para mostrarla.
 */
export const noteRepository = {
  async addNote(input: {
    bookId: string;
    type: NoteType;
    charIndex: number;
    page: number | null;
    body: string | null;
    comment: string | null;
  }): Promise<BookNote> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const note: BookNote = { id: createNoteId(), createdAt: now, updatedAt: now, ...input };
    await db.runAsync(
      `INSERT INTO notes (${NOTE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [note.id, note.bookId, note.type, note.charIndex, note.page, note.body, note.comment, now, now],
    );
    return note;
  },

  async updateComment(noteId: string, comment: string | null): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE notes SET comment = ?, updatedAt = ? WHERE id = ?', [
      comment,
      new Date().toISOString(),
      noteId,
    ]);
  },

  /**
   * Re-ubica las anotaciones hechas sobre una PÁGINA (PDF, cómic) cuando cambia el
   * texto del libro: su posición en el texto sale de la página, que es lo estable.
   */
  async relocatePagedNotes(bookId: string, charIndexForPage: (page: number) => number): Promise<void> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; page: number }>(
      'SELECT id, page FROM notes WHERE bookId = ? AND page IS NOT NULL',
      [bookId],
    );
    for (const row of rows) {
      await db.runAsync('UPDATE notes SET charIndex = ? WHERE id = ?', [charIndexForPage(row.page), row.id]);
    }
  },

  async removeNote(noteId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM notes WHERE id = ?', [noteId]);
  },

  /** Todas las anotaciones del libro, en el orden en que aparecen en el texto. */
  async listForBook(bookId: string): Promise<BookNote[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE bookId = ? ORDER BY charIndex ASC, createdAt ASC`,
      [bookId],
    );
    return rows.map(mapNoteRow);
  },

  /** Marcador existente cerca de una posición (para alternar con un solo toque). */
  async findBookmarkNear(bookId: string, charIndex: number, tolerance: number): Promise<BookNote | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes
       WHERE bookId = ? AND type = 'bookmark' AND charIndex BETWEEN ? AND ?
       ORDER BY ABS(charIndex - ?) ASC LIMIT 1`,
      [bookId, charIndex - tolerance, charIndex + tolerance, charIndex],
    );
    return row ? mapNoteRow(row) : null;
  },

  /**
   * Todas tus notas de todos los libros, con el título del libro al lado.
   *
   * Es para la pantalla "Mis notas": muchas veces te acordás de la cita pero no
   * de en qué libro estaba. Sin `query` devuelve las últimas.
   *
   * Se filtra en SQL y no en memoria: las notas crecen con los años y traerlas
   * todas para filtrar acá sería traer el archivo entero en cada tecla.
   */
  async searchAll(query: string, limit = 200): Promise<NoteWithBook[]> {
    const db = await getDatabase();
    const limpio = query.trim();
    const base = `SELECT n.id, n.bookId, n.type, n.charIndex, n.page, n.body, n.comment,
                         n.createdAt, n.updatedAt, b.title AS bookTitle, b.name AS bookName, b.author AS bookAuthor
                  FROM notes n JOIN books b ON b.id = n.bookId`;
    const rows = limpio.length === 0
      ? await db.getAllAsync<NoteRow & { bookTitle: string | null; bookName: string; bookAuthor: string | null }>(
          `${base} ORDER BY n.updatedAt DESC LIMIT ?`, [limit])
      : await db.getAllAsync<NoteRow & { bookTitle: string | null; bookName: string; bookAuthor: string | null }>(
          `${base}
           WHERE n.body LIKE ? OR n.comment LIKE ? OR b.title LIKE ? OR b.name LIKE ?
           ORDER BY n.updatedAt DESC LIMIT ?`,
          [`%${limpio}%`, `%${limpio}%`, `%${limpio}%`, `%${limpio}%`, limit]);
    return rows.map((row) => ({
      ...mapNoteRow(row),
      bookTitle: row.bookTitle,
      bookName: row.bookName,
      bookAuthor: row.bookAuthor,
    }));
  },

  async countForBook(bookId: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM notes WHERE bookId = ?', [bookId]);
    return row?.total ?? 0;
  },
};
