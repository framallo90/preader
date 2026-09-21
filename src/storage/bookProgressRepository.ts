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

// Serializa las escrituras de progreso POR LIBRO: el audio y el scroll pueden
// disparar saveProgress casi a la vez, y sin esto dos writes concurrentes sobre
// la misma fila se intercalan. Encadenar por bookId garantiza orden.
const writeChains = new Map<string, Promise<unknown>>();

function serializeByBook<T>(bookId: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(bookId) ?? Promise.resolve();
  const next = prev.then(task, task); // corre después de la previa, gane o falle
  // Guardamos una versión que nunca rechaza para que la cadena no se corte;
  // el caller recibe el resultado/rechazo real vía `next`. El mapa tiene una
  // entrada por libro (acotado), se reemplaza en cada escritura.
  writeChains.set(bookId, next.catch(() => {}));
  return next;
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
    await serializeByBook(progress.bookId, async () => {
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
    });
  },

  /** Borra el progreso del libro: la próxima apertura arranca desde el principio. */
  async resetProgress(bookId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM reading_progress WHERE bookId = ?', [bookId]);
  },
};
