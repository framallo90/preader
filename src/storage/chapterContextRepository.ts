import { getDatabase } from './database';
import { ChapterContext } from '../types/storage';

type ChapterContextRow = {
  chapterId: string;
  beforeSummary: string | null;
  afterSummary: string | null;
  characters: string;
  keyEvents: string;
  extractedAt: string;
};

function mapContextRow(row: ChapterContextRow): ChapterContext {
  let characters: string[] = [];
  let keyEvents: string[] = [];

  try { characters = JSON.parse(row.characters) as string[]; } catch { characters = []; }
  try { keyEvents = JSON.parse(row.keyEvents) as string[]; } catch { keyEvents = []; }

  return {
    chapterId: row.chapterId,
    beforeSummary: row.beforeSummary,
    afterSummary: row.afterSummary,
    characters,
    keyEvents,
    extractedAt: row.extractedAt,
  };
}

export const chapterContextRepository = {
  async saveContext(context: ChapterContext): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO chapter_context (chapterId, beforeSummary, afterSummary, characters, keyEvents, extractedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chapterId) DO UPDATE SET
         beforeSummary = excluded.beforeSummary,
         afterSummary = excluded.afterSummary,
         characters = excluded.characters,
         keyEvents = excluded.keyEvents,
         extractedAt = excluded.extractedAt`,
      [
        context.chapterId,
        context.beforeSummary ?? null,
        context.afterSummary ?? null,
        JSON.stringify(context.characters),
        JSON.stringify(context.keyEvents),
        context.extractedAt,
      ],
    );
  },

  async getContextForChapter(chapterId: string): Promise<ChapterContext | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ChapterContextRow>(
      'SELECT * FROM chapter_context WHERE chapterId = ?',
      [chapterId],
    );
    return row ? mapContextRow(row) : null;
  },

  /**
   * Devuelve el afterSummary del capítulo anterior al dado.
   * Usado para construir el "beforeSummary" del capítulo actual.
   */
  async getPreviousChapterSummary(bookId: string, currentOrderIndex: number): Promise<string> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ afterSummary: string | null }>(
      `SELECT cc.afterSummary
       FROM chapter_context cc
       INNER JOIN chapters c ON c.id = cc.chapterId
       WHERE c.bookId = ? AND c.orderIndex < ?
       ORDER BY c.orderIndex DESC
       LIMIT 1`,
      [bookId, currentOrderIndex],
    );
    return row?.afterSummary ?? '';
  },

  async deleteContextForChapter(chapterId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM chapter_context WHERE chapterId = ?', [chapterId]);
  },
};
