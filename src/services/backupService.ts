import { getDatabase } from '../storage/database';
import { bookRepository } from '../storage/bookRepository';
import { collectionRepository } from '../storage/collectionRepository';
import { settingsRepository } from '../storage/settingsRepository';
import { AppSettings, DEFAULT_SETTINGS } from '../types/storage';
import {
  BACKUP_VERSION,
  BackupFile,
  planRestore,
  portableSettings,
  shouldReplaceProgress,
} from '../utils/backupFormat';

/**
 * Exportar e importar tus datos.
 *
 * Hace falta porque el respaldo automático de Android está apagado a propósito
 * (subía la biblioteca y las notas a Google, en una app que se presenta como
 * local). Esto es lo mismo pero decidido por vos y sin nube de por medio.
 *
 * Lo que se guarda es lo que NO se puede regenerar. El texto procesado, las
 * tapas y las páginas dibujadas quedan afuera: se vuelven a generar solos.
 */

export type RestoreSummary = {
  books: number;
  progress: number;
  notes: number;
  collections: number;
  /** Días con tiempo leído o escuchado. */
  stats: number;
  /** Anotaciones y progreso de libros que todavía no están en esta biblioteca. */
  skipped: number;
};

export async function buildBackup(settings: AppSettings): Promise<string> {
  const db = await getDatabase();
  const books = await bookRepository.listAllBooks();
  const progress = await db.getAllAsync<{
    bookId: string; chapterId: string | null; blockIndex: number; charIndex: number;
    percentage: number; page: number | null; textLength: number | null; updatedAt: string;
  }>(
    `SELECT bookId, chapterId, blockIndex, charIndex, percentage, page, textLength, updatedAt
     FROM reading_progress`,
  );
  const notes = await db.getAllAsync<{
    id: string; bookId: string; type: string; charIndex: number; page: number | null;
    body: string | null; comment: string | null; createdAt: string; updatedAt: string;
  }>('SELECT id, bookId, type, charIndex, page, body, comment, createdAt, updatedAt FROM notes');

  const collections = await collectionRepository.listCollections();
  const conLibros = await Promise.all(
    collections.map(async (collection) => ({
      id: collection.id,
      name: collection.name,
      bookIds: await collectionRepository.listBookIdsInCollection(collection.id),
    })),
  );

  const archivo: BackupFile = {
    app: 'bardo',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    books: books.map((book) => ({
      id: book.id,
      name: book.name,
      title: book.title,
      author: book.author,
      summary: book.summary,
      status: book.status,
      favorite: book.favorite,
      rating: book.rating,
      review: book.review,
      orderIndex: book.orderIndex,
      rate: book.rate,
      voiceId: book.voiceId,
    })),
    progress,
    notes: notes.map((note) => ({ ...note, type: note.type as BackupFile['notes'][number]['type'] })),
    collections: conLibros,
    stats: await db.getAllAsync<BackupFile['stats'][number]>('SELECT bookId, day, mode, seconds FROM reading_stats'),
    settings: portableSettings(settings),
  };
  // Con sangría: un respaldo que se puede abrir y leer da confianza de que
  // ahí está lo tuyo, y pesa kilobytes igual.
  return JSON.stringify(archivo, null, 2);
}

/**
 * Aplica un respaldo sobre la biblioteca de ESTE teléfono.
 *
 * Nunca borra ni crea libros: sólo devuelve lo tuyo a los libros que ya están.
 * Los libros se reconocen por la huella de su contenido, así que funciona
 * aunque estén en otra carpeta o con otro nombre.
 */
export async function applyBackup(backup: BackupFile): Promise<RestoreSummary> {
  const existentes = await bookRepository.listAllBooks();
  const conocidos = new Set(existentes.map((book) => book.id));
  const resumen: RestoreSummary = { books: 0, progress: 0, notes: 0, collections: 0, stats: 0, skipped: 0 };

  // ── Lo del libro: estado, reseña, orden, velocidad ────────────────────────
  for (const book of backup.books) {
    if (!conocidos.has(book.id)) { resumen.skipped += 1; continue; }
    await bookRepository.setStatus(book.id, book.status);
    await bookRepository.setFavorite(book.id, book.favorite);
    await bookRepository.setReview(book.id, book.rating, book.review);
    if (book.title) await bookRepository.setTitle(book.id, book.title);
    if (book.summary) await bookRepository.setSummary(book.id, book.summary);
    if (book.orderIndex > 0) await bookRepository.setOrder([{ id: book.id, orderIndex: book.orderIndex }]);
    if (book.rate != null || book.voiceId != null) {
      await bookRepository.setPlaybackPrefs(book.id, { rate: book.rate, voiceId: book.voiceId });
    }
    resumen.books += 1;
  }

  // ── Progreso: sólo si el del respaldo es más nuevo ────────────────────────
  const progreso = planRestore(backup.progress, conocidos);
  resumen.skipped += progreso.skipped;
  const db = await getDatabase();
  for (const entry of progreso.apply) {
    const actual = await db.getFirstAsync<{ updatedAt: string }>(
      'SELECT updatedAt FROM reading_progress WHERE bookId = ?',
      [entry.bookId],
    );
    if (!shouldReplaceProgress(actual, entry)) continue;
    await db.runAsync(
      `INSERT INTO reading_progress (bookId, chapterId, blockIndex, charIndex, percentage, page, textLength, updatedAt, finishedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? >= 99.5 THEN ? ELSE NULL END)
       ON CONFLICT(bookId) DO UPDATE SET
         chapterId = excluded.chapterId, blockIndex = excluded.blockIndex,
         charIndex = excluded.charIndex, percentage = excluded.percentage,
         page = excluded.page, textLength = excluded.textLength, updatedAt = excluded.updatedAt,
         finishedAt = CASE WHEN excluded.percentage >= 99.5 AND finishedAt IS NULL THEN excluded.updatedAt ELSE finishedAt END`,
      [entry.bookId, entry.chapterId, entry.blockIndex, entry.charIndex, entry.percentage,
        entry.page ?? null, entry.textLength ?? null, entry.updatedAt, entry.percentage, entry.updatedAt],
    );
    resumen.progress += 1;
  }

  // ── Notas: por id, así importar dos veces no duplica ──────────────────────
  const notas = planRestore(backup.notes, conocidos);
  resumen.skipped += notas.skipped;
  for (const note of notas.apply) {
    await db.runAsync(
      `INSERT INTO notes (id, bookId, type, charIndex, page, body, comment, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         body = excluded.body, comment = excluded.comment, updatedAt = excluded.updatedAt`,
      [note.id, note.bookId, note.type, note.charIndex, note.page ?? null,
        note.body ?? null, note.comment ?? null, note.createdAt, note.updatedAt],
    );
    resumen.notes += 1;
  }

  // ── Colecciones: se reusa la que ya exista con ese nombre ─────────────────
  const actuales = await collectionRepository.listCollections();
  const porNombre = new Map(actuales.map((c) => [c.name.trim().toLowerCase(), c.id]));
  for (const collection of backup.collections) {
    const nombre = collection.name.trim();
    if (nombre.length === 0) continue;
    let id = porNombre.get(nombre.toLowerCase());
    if (!id) {
      const creada = await collectionRepository.createCollection(nombre);
      id = creada.id;
      porNombre.set(nombre.toLowerCase(), id);
    }
    for (const bookId of collection.bookIds) {
      if (!conocidos.has(bookId)) continue;
      await collectionRepository.setBookInCollection(bookId, id, true);
    }
    resumen.collections += 1;
  }

  // ── Estadísticas: se quedan con el MAYOR de los dos valores del día ───────
  // Así importar dos veces el mismo respaldo no duplica el tiempo, y lo que
  // leíste en este teléfono después de exportar no se pierde. Entran aunque
  // el libro no esté: son tu historia, no la del archivo.
  if (backup.stats.length > 0) {
    for (const stat of backup.stats) {
      await db.runAsync(
        `INSERT INTO reading_stats (bookId, day, mode, seconds) VALUES (?, ?, ?, ?)
         ON CONFLICT(bookId, day, mode) DO UPDATE SET seconds = MAX(seconds, excluded.seconds)`,
        [stat.bookId, stat.day, stat.mode, stat.seconds],
      );
      resumen.stats += 1;
    }
  }

  // Sólo claves de ajustes conocidas: un archivo editado a mano no puede
  // escribir cualquier fila de la tabla settings (ocultos, versión del caché).
  const conocidas = new Set(Object.keys(DEFAULT_SETTINGS));
  const ajustes = Object.fromEntries(
    Object.entries(backup.settings).filter(([key]) => conocidas.has(key)),
  ) as Partial<AppSettings>;
  if (Object.keys(ajustes).length > 0) {
    await settingsRepository.saveSettings(ajustes);
  }
  return resumen;
}
