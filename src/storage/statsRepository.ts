import { getDatabase } from './database';
import { DayRow, StatsMode } from '../utils/readingStats';

/**
 * Tiempo leído y escuchado, por libro y por día.
 *
 * Se SUMA sobre la fila del día (upsert) en vez de guardar una fila por
 * sesión: así la tabla crece con los días, no con cada vez que abrís un libro.
 */
export const statsRepository = {
  async addSeconds(bookId: string, day: string, mode: StatsMode, seconds: number): Promise<void> {
    if (!(seconds > 0)) return;
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO reading_stats (bookId, day, mode, seconds) VALUES (?, ?, ?, ?)
       ON CONFLICT(bookId, day, mode) DO UPDATE SET seconds = seconds + excluded.seconds`,
      [bookId, day, mode, seconds],
    );
  },

  /** Totales por día y modo desde `fromDay` (todos los libros juntos). */
  async listDaysSince(fromDay: string): Promise<DayRow[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ day: string; mode: string; seconds: number }>(
      `SELECT day, mode, SUM(seconds) AS seconds FROM reading_stats
       WHERE day >= ? GROUP BY day, mode ORDER BY day`,
      [fromDay],
    );
    return rows.map((row) => ({ day: row.day, mode: row.mode === 'listen' ? 'listen' : 'read', seconds: row.seconds }));
  },

  /** Los libros a los que más tiempo les dedicaste desde `fromDay`. */
  async topBooksSince(fromDay: string, limit = 5): Promise<{ bookId: string; seconds: number }[]> {
    const db = await getDatabase();
    return db.getAllAsync<{ bookId: string; seconds: number }>(
      `SELECT bookId, SUM(seconds) AS seconds FROM reading_stats
       WHERE day >= ? GROUP BY bookId ORDER BY seconds DESC LIMIT ?`,
      [fromDay, limit],
    );
  },
};

/**
 * Libros terminados desde `fromIso`: los que llegaron al final (progreso de
 * 99,5 % o más) con la última lectura en ese período. Marcar "leído" a mano no
 * guarda fecha, así que esos no entran en la cuenta del año.
 */
export async function countFinishedSince(fromIso: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM reading_progress WHERE finishedAt >= ?',
    [fromIso],
  );
  return row?.total ?? 0;
}
