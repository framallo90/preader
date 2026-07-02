import { getDatabase } from './database';
import { Chapter } from '../types/storage';
import { ChapterInfo } from '../types/document';

type ChapterRow = {
  id: string;
  bookId: string;
  orderIndex: number;
  title: string;
  povCharacter: string | null;
  povNumber: number | null;
  startChar: number;
  endChar: number;
};

function mapChapterRow(row: ChapterRow): Chapter {
  return {
    id: row.id,
    bookId: row.bookId,
    orderIndex: row.orderIndex,
    title: row.title,
    povCharacter: row.povCharacter,
    povNumber: row.povNumber,
    startChar: row.startChar,
    endChar: row.endChar,
  };
}

export const chapterRepository = {
  /**
   * Guarda todos los capítulos de un libro de una vez.
   * Reemplaza los existentes para ese bookId.
   */
  async saveChaptersForBook(bookId: string, chapters: ChapterInfo[]): Promise<void> {
    const db = await getDatabase();

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM chapters WHERE bookId = ?', [bookId]);

      for (const chapter of chapters) {
        await db.runAsync(
          `INSERT INTO chapters (id, bookId, orderIndex, title, povCharacter, povNumber, startChar, endChar)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chapter.id,
            bookId,
            chapter.orderIndex,
            chapter.title,
            chapter.povCharacter ?? null,
            chapter.povNumber ?? null,
            chapter.startChar,
            chapter.endChar,
          ],
        );
      }
    });
  },

  async getChapterById(chapterId: string): Promise<Chapter | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ChapterRow>(
      'SELECT id, bookId, orderIndex, title, povCharacter, povNumber, startChar, endChar FROM chapters WHERE id = ?',
      [chapterId],
    );
    return row ? mapChapterRow(row) : null;
  },

  async listChaptersForBook(bookId: string): Promise<Chapter[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ChapterRow>(
      `SELECT id, bookId, orderIndex, title, povCharacter, povNumber, startChar, endChar
       FROM chapters WHERE bookId = ? ORDER BY orderIndex ASC`,
      [bookId],
    );
    return rows.map(mapChapterRow);
  },

  /**
   * Devuelve el capítulo que contiene un charIndex dado.
   * Útil para saber en qué capítulo está el lector según su posición de audio.
   */
  async getChapterAtChar(bookId: string, charIndex: number): Promise<Chapter | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ChapterRow>(
      `SELECT id, bookId, orderIndex, title, povCharacter, povNumber, startChar, endChar
       FROM chapters
       WHERE bookId = ? AND startChar <= ? AND endChar >= ?
       ORDER BY orderIndex ASC
       LIMIT 1`,
      [bookId, charIndex, charIndex],
    );
    return row ? mapChapterRow(row) : null;
  },

  async listChaptersByPov(bookId: string, povCharacter: string): Promise<Chapter[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ChapterRow>(
      `SELECT id, bookId, orderIndex, title, povCharacter, povNumber, startChar, endChar
       FROM chapters WHERE bookId = ? AND povCharacter = ? ORDER BY orderIndex ASC`,
      [bookId, povCharacter],
    );
    return rows.map(mapChapterRow);
  },
};
