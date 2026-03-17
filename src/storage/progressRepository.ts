import { getDatabase } from './database';
import { ReadingProgress } from '../types/storage';

type SaveProgressInput = {
  documentId: string;
  blockIndex: number;
  charIndex: number;
  percentage: number;
};

type ProgressRow = {
  documentId: string;
  blockIndex: number;
  charIndex: number | null;
  percentage: number | null;
  updatedAt: string;
};

function mapProgressRow(row: ProgressRow): ReadingProgress {
  return {
    documentId: row.documentId,
    blockIndex: row.blockIndex,
    charIndex: row.charIndex ?? 0,
    percentage: row.percentage ?? 0,
    updatedAt: row.updatedAt,
  };
}

export const progressRepository = {
  async getProgress(documentId: string) {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ProgressRow>(
      `
        SELECT documentId, blockIndex, charIndex, percentage, updatedAt
        FROM reading_progress
        WHERE documentId = ?
      `,
      [documentId],
    );

    return row ? mapProgressRow(row) : null;
  },

  async saveProgress({ documentId, blockIndex, charIndex, percentage }: SaveProgressInput) {
    const db = await getDatabase();
    const updatedAt = new Date().toISOString();

    await db.runAsync(
      `
        INSERT INTO reading_progress (documentId, blockIndex, charIndex, percentage, updatedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(documentId) DO UPDATE SET
          blockIndex = excluded.blockIndex,
          charIndex = excluded.charIndex,
          percentage = excluded.percentage,
          updatedAt = excluded.updatedAt
      `,
      [documentId, blockIndex, charIndex, percentage, updatedAt],
    );
  },
};
