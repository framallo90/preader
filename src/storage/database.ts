import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

// Nombre heredado de cuando la app se llamaba así: cambiarlo dejaría la biblioteca
// del teléfono en un archivo huérfano.
const DATABASE_NAME = 'pdf-voice-reader.db';
const CURRENT_DB_VERSION = 6;
let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME).catch((error) => {
      // Si abrir falló, que el próximo intento vuelva a probar en vez de quedar
      // pegado a una promesa rechazada para siempre.
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

/**
 * Suelta la instancia para que el próximo `getDatabase()` vuelva a abrir.
 *
 * El objeto nativo de SQLite puede quedar liberado por debajo (pasa al
 * actualizar la app con el proceso vivo). A partir de ahí TODA consulta falla
 * con "shared object already released" y la biblioteca se ve vacía, con un
 * cartel de error, hasta que la cierres y la abras a mano.
 */
export function resetDatabaseHandle() {
  databasePromise = null;
}

/**
 * Corre algo contra la base y, si el objeto nativo quedó liberado por debajo,
 * la reabre y lo intenta UNA vez más.
 *
 * Pasa al actualizar la app con el proceso vivo: a partir de ahí toda consulta
 * falla y la pantalla queda en un error sin salida, aunque los datos estén
 * intactos. Reabrir es barato y lo arregla.
 */
export async function withDatabaseRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isStaleDatabaseError(error)) throw error;
    resetDatabaseHandle();
    return run();
  }
}

/** ¿El error es "la base quedó inutilizable" y conviene reabrir y reintentar? */
export function isStaleDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already released|NativeStatement|NativeDatabase/i.test(message);
}

export async function initializeDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    -- === Legacy (mantenido para compatibilidad) ===
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      uri TEXT NOT NULL,
      type TEXT,
      importedAt TEXT NOT NULL,
      lastOpenedAt TEXT NOT NULL
    );

    -- OJO: esto vive dentro de un template literal de JavaScript, así que acá NO
    -- se pueden usar comillas invertidas.
    -- La tabla sagas y las columnas books.sagaId / books.orderIndex son un
    -- resto de una jerarquía saga → libro que nunca se terminó. Ya NO se leen ni
    -- se escriben desde el código (ver bookRepository). Se dejan porque sacar una
    -- columna en SQLite obliga a reconstruir la tabla entera, y no molestan.
    -- Si algún día se hacen las series de libros, la base ya está.

    CREATE TABLE IF NOT EXISTS sagas (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY NOT NULL,
      sagaId TEXT,
      name TEXT NOT NULL,
      orderIndex INTEGER NOT NULL DEFAULT 0,
      uri TEXT NOT NULL,
      type TEXT NOT NULL,
      importedAt TEXT NOT NULL,
      lastOpenedAt TEXT NOT NULL,
      FOREIGN KEY (sagaId) REFERENCES sagas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY NOT NULL,
      bookId TEXT NOT NULL,
      orderIndex INTEGER NOT NULL,
      title TEXT NOT NULL,
      povCharacter TEXT,
      povNumber INTEGER,
      startChar INTEGER NOT NULL,
      endChar INTEGER NOT NULL,
      FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      bookId TEXT PRIMARY KEY NOT NULL,
      chapterId TEXT,
      blockIndex INTEGER NOT NULL DEFAULT 0,
      charIndex INTEGER NOT NULL DEFAULT 0,
      percentage REAL NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parsed_document_cache (
      bookId TEXT PRIMARY KEY NOT NULL,
      fullText TEXT NOT NULL,
      blocksJson TEXT NOT NULL,
      chaptersJson TEXT NOT NULL,
      savedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    -- Marcadores, citas y notas en una sola tabla, distinguidos por type.
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      bookId TEXT NOT NULL,
      type TEXT NOT NULL,
      charIndex INTEGER NOT NULL,
      page INTEGER,
      body TEXT,
      comment TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notes_book ON notes (bookId, charIndex);

    -- Colecciones: un libro puede estar en varias.
    CREATE TABLE IF NOT EXISTS colls (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS books_to_colls (
      bookId TEXT NOT NULL,
      collId TEXT NOT NULL,
      PRIMARY KEY (bookId, collId),
      FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (collId) REFERENCES colls(id) ON DELETE CASCADE
    );
  `);

  await runMigrations(db);
}

/**
 * Migraciones versionadas con PRAGMA user_version.
 * CREATE TABLE IF NOT EXISTS no altera tablas existentes, así que todo
 * cambio de schema sobre instalaciones previas debe declararse acá.
 */
async function runMigrations(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    // v1: metadata de libro (título y autor reales + portada extraída).
    await addColumnIfMissing(db, 'books', 'title', 'TEXT');
    await addColumnIfMissing(db, 'books', 'author', 'TEXT');
    await addColumnIfMissing(db, 'books', 'coverUri', 'TEXT');
  }

  if (version < 2) {
    // v2: se fue la capa de IA (contexto por capítulo y personajes).
    await db.execAsync(`
      DROP TABLE IF EXISTS chapter_context;
      DROP TABLE IF EXISTS characters;
    `);
  }

  if (version < 3) {
    // v3: el PDF se procesa en el teléfono; el caché guarda su mapa de páginas.
    await addColumnIfMissing(db, 'parsed_document_cache', 'pdfInfoJson', 'TEXT');
  }

  if (version < 4) {
    // v4: listas de lectura, favoritos y reseña con estrellas.
    await addColumnIfMissing(db, 'books', 'status', "TEXT NOT NULL DEFAULT 'none'");
    await addColumnIfMissing(db, 'books', 'favorite', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'books', 'rating', 'INTEGER');
    await addColumnIfMissing(db, 'books', 'review', 'TEXT');
  }

  if (version < 5) {
    // v5: el progreso recuerda la página y sobre qué texto se midió (los PDF abren
    // al instante con un documento provisorio y el texto llega después).
    await addColumnIfMissing(db, 'reading_progress', 'page', 'INTEGER');
    await addColumnIfMissing(db, 'reading_progress', 'textLength', 'INTEGER');
  }

  if (version < 6) {
    // v6: resumen del libro (la sinopsis que trae el archivo, las primeras
    // líneas de la prosa, o lo que escribas vos).
    await addColumnIfMissing(db, 'books', 'summary', 'TEXT');
  }

  if (version < CURRENT_DB_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${CURRENT_DB_VERSION}`);
  }
}

async function addColumnIfMissing(db: SQLiteDatabase, table: string, column: string, type: string) {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (error) {
    // Solo tragamos "columna ya existe" (migración corrida a medias). Cualquier
    // otro error (DB locked, I/O) se RE-LANZA para que user_version NO suba y la
    // migración reintente en el próximo arranque; si no, la app quedaría leyendo
    // una columna que nunca se creó → "no such column" y biblioteca imposible de abrir.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!message.includes('duplicate column')) throw error;
  }
}
