import { getDatabase } from './database';
import { ReadingProgress } from '../types/storage';

type ProgressRow = {
  bookId: string;
  chapterId: string | null;
  blockIndex: number;
  charIndex: number | null;
  percentage: number | null;
  updatedAt: string;
};

function mapProgressRow(row: ProgressRow): ReadingProgress {
  return {
    bookId: row.bookId,
    chapterId: row.chapterId,
    blockIndex: row.blockIndex,
    charIndex: row.charIndex ?? 0,
    percentage: row.percentage ?? 0,
    updatedAt: row.updatedAt,
  };
}

export const bookProgressRepository = {
  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ProgressRow>(
      'SELECT bookId, chapterId, blockIndex, charIndex, percentage, updatedAt FROM reading_progress WHERE bookId = ?',
      [bookId],
    );
    return row ? mapProgressRow(row) : null;
  },

  async saveProgress(progress: {
    bookId: string;
    chapterId: string | null;
    blockIndex: number;
    charIndex: number;
    percentage: number;
  }): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO reading_progress (bookId, chapterId, blockIndex, charIndex, percentage, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(bookId) DO UPDATE SET
         chapterId = excluded.chapterId,
         blockIndex = excluded.blockIndex,
         charIndex = excluded.charIndex,
         percentage = excluded.percentage,
         updatedAt = excluded.updatedAt`,
      [
        progress.bookId,
        progress.chapterId ?? null,
        progress.blockIndex,
        progress.charIndex,
        progress.percentage,
        new Date().toISOString(),
      ],
    );
  },
};
