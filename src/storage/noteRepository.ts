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

  async countForBook(bookId: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM notes WHERE bookId = ?', [bookId]);
    return row?.total ?? 0;
  },
};
