import { getDatabase } from './database';
import { ReadingProgress } from '../types/storage';

type ProgressRow = {
  bookId: string;
  chapterId: string | null;
  blockIndex: number;
  charIndex: number | null;
  percentage: number | null;
  page: number | null;
  textLength: number | null;
  updatedAt: string;
};

function mapProgressRow(row: ProgressRow): ReadingProgress {
  return {
    bookId: row.bookId,
    chapterId: row.chapterId,
    blockIndex: row.blockIndex,
    charIndex: row.charIndex ?? 0,
    percentage: row.percentage ?? 0,
    page: row.page ?? null,
    textLength: row.textLength ?? null,
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
      'SELECT bookId, chapterId, blockIndex, charIndex, percentage, page, textLength, updatedAt FROM reading_progress WHERE bookId = ?',
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
    page?: number | null;
    textLength?: number | null;
  }): Promise<void> {
    await serializeByBook(progress.bookId, async () => {
      const db = await getDatabase();
      const now = new Date().toISOString();
      // finishedAt: la PRIMERA vez que el progreso llega al final. Es lo que
      // cuenta la meta del año; no se pisa aunque el libro se relea.
      await db.runAsync(
        `INSERT INTO reading_progress (bookId, chapterId, blockIndex, charIndex, percentage, page, textLength, updatedAt, finishedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? >= 99.5 THEN ? ELSE NULL END)
         ON CONFLICT(bookId) DO UPDATE SET
           chapterId = excluded.chapterId,
           blockIndex = excluded.blockIndex,
           charIndex = excluded.charIndex,
           percentage = excluded.percentage,
           page = excluded.page,
           textLength = excluded.textLength,
           updatedAt = excluded.updatedAt,
           finishedAt = CASE WHEN excluded.percentage >= 99.5 AND finishedAt IS NULL THEN excluded.updatedAt ELSE finishedAt END`,
        [
          progress.bookId,
          progress.chapterId ?? null,
          progress.blockIndex,
          progress.charIndex,
          progress.percentage,
          progress.page ?? null,
          progress.textLength ?? null,
          now,
          progress.percentage,
          now,
        ],
      );
    });
  },

  /** Borra el progreso del libro: la próxima apertura arranca desde el principio. */
  async resetProgress(bookId: string): Promise<void> {
    const db = await getDatabase();
    // Se vuelve al principio pero se CONSERVA finishedAt: releer un libro
    // terminado no lo saca de la meta del año.
    await db.runAsync(
      'UPDATE reading_progress SET chapterId = NULL, blockIndex = 0, charIndex = 0, percentage = 0, page = NULL, updatedAt = ? WHERE bookId = ?',
      [new Date().toISOString(), bookId],
    );
  },
};
