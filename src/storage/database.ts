import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

const DATABASE_NAME = 'pdf-voice-reader.db';
const CURRENT_DB_VERSION = 4;
let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

export async function initializeDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
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

    -- === Nuevas tablas: jerarquía Saga → Libro → Capítulo ===

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
