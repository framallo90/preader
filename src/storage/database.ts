import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

// Nombre heredado de cuando la app se llamaba así: cambiarlo dejaría la biblioteca
// del teléfono en un archivo huérfano.
const DATABASE_NAME = 'pdf-voice-reader.db';
const CURRENT_DB_VERSION = 11;
let databasePromise: Promise<SQLiteDatabase> | null = null;
// La conexión ya abierta, para poder preguntarle si sigue viva sin esperar.
let currentDatabase: SQLiteDatabase | null = null;

/**
 * Por qué cada apertura pide una conexión NUEVA (`useNewConnection`).
 *
 * expo-sqlite, al abrir otra vez el mismo archivo, devuelve el MISMO objeto
 * nativo envuelto en un objeto JavaScript nuevo. Cuando el recolector de
 * basura se lleva el envoltorio viejo, el objeto nativo cierra la conexión
 * (sin mirar que hay otro envoltorio usándola) y queda en el caché del módulo
 * como si estuviera abierto. Desde ahí, toda consulta tira
 * "NullPointerException" y toda apertura nueva devuelve ese mismo muerto:
 * "No se pudo iniciar la app" hasta forzar la detención. Lo disparaba
 * cualquier error común de una consulta, porque reabrir era la respuesta a
 * todo. Con conexión propia, un envoltorio viejo sólo puede cerrar la suya.
 */
function openConnection(): Promise<SQLiteDatabase> {
  const opening: Promise<SQLiteDatabase> = openDatabaseAsync(DATABASE_NAME, { useNewConnection: true })
    .then(async (db) => {
      // Por CONEXIÓN, no sólo al inicializar: una conexión nueva arranca sin
      // foreign_keys, y borrar un libro dejaba notas y capítulos huérfanos.
      // busy_timeout: si alguna vez conviven dos conexiones (la vieja todavía
      // sin cerrar), una escritura espera en vez de fallar en el acto.
      await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
      if (databasePromise === opening) currentDatabase = db;
      return db;
    })
    .catch((error) => {
      // Si abrir falló, que el próximo intento vuelva a probar en vez de quedar
      // pegado a una promesa rechazada para siempre.
      if (databasePromise === opening) databasePromise = null;
      throw error;
    });
  databasePromise = opening;
  return opening;
}

/** ¿La conexión nativa sigue viva? Una pregunta sincrónica mínima: si murió, tira. */
function isConnectionAlive(db: SQLiteDatabase): boolean {
  try {
    db.isInTransactionSync();
    return true;
  } catch {
    return false;
  }
}

/** Suelta una conexión y la cierra de verdad (si ya estaba muerta, cerrarla falla y no importa). */
function discardConnection(db: SQLiteDatabase | null) {
  if (db && currentDatabase !== db) {
    void db.closeAsync().catch(() => {});
    return;
  }
  currentDatabase = null;
  databasePromise = null;
  if (db) void db.closeAsync().catch(() => {});
}

export async function getDatabase() {
  // Cada pedido mira primero si la conexión sigue viva: si murió por debajo,
  // se abre otra ahí mismo, en vez de que la app quede rota hasta reiniciarla.
  if (currentDatabase && !isConnectionAlive(currentDatabase)) {
    console.warn('[db] la conexión nativa murió: se abre una nueva');
    discardConnection(currentDatabase);
  }
  return databasePromise ?? openConnection();
}

/**
 * Suelta la conexión para que el próximo `getDatabase()` abra otra. Sólo para
 * una conexión muerta (ver isStaleDatabaseError).
 */
export function resetDatabaseHandle() {
  discardConnection(currentDatabase);
}

// Las transacciones de expo-sqlite no se excluyen entre sí: dos al mismo
// tiempo sobre la misma conexión daban "cannot start a transaction within a
// transaction" (cambiar un ajuste mientras se guardaban los capítulos de un
// libro). Se encolan.
let transactionChain: Promise<unknown> = Promise.resolve();

/**
 * `db.withTransactionAsync`, pero de a una por vez. Lo de adentro no puede
 * abrir otra transacción con esto mismo (se trabaría esperándose).
 */
export function runInTransaction(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  const next = transactionChain.then(
    () => db.withTransactionAsync(task),
    () => db.withTransactionAsync(task),
  );
  transactionChain = next.catch(() => {});
  return next;
}

/**
 * Corre algo contra la base y, si la conexión nativa murió por debajo, abre
 * otra y lo intenta UNA vez más. Un error común (una consulta mal, la base
 * ocupada) NO reabre: se devuelve tal cual.
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

/**
 * ¿La conexión quedó inutilizable y conviene abrir otra? Sólo los errores de
 * conexión muerta. Antes cualquier error de la base contaba (todos dicen
 * "NativeDatabase" en el mensaje), y reabrir por un error común era justo lo
 * que terminaba matando la conexión.
 */
export function isStaleDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already released|NullPointerException|Access to closed resource/i.test(message);
}

export async function initializeDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    -- OJO: esto vive dentro de un template literal de JavaScript, así que acá NO
    -- se pueden usar comillas invertidas.
    -- Las columnas que faltan acá (title, author, coverUri, estado, etc.) las
    -- agregan las migraciones de abajo: así una instalación nueva y una vieja
    -- terminan con la misma tabla.
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      orderIndex INTEGER NOT NULL DEFAULT 0,
      uri TEXT NOT NULL,
      type TEXT NOT NULL,
      importedAt TEXT NOT NULL,
      lastOpenedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY NOT NULL,
      bookId TEXT NOT NULL,
      orderIndex INTEGER NOT NULL,
      title TEXT NOT NULL,
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

  if (version < 7) {
    // v7: velocidad y voz propias de cada libro. Un ensayo se escucha a 1,2x y
    // una novela a 1,6x; tener un solo valor global obligaba a reajustar cada
    // vez que cambiabas de libro. NULL = usar el ajuste general.
    await addColumnIfMissing(db, 'books', 'rate', 'REAL');
    await addColumnIfMissing(db, 'books', 'voiceId', 'TEXT');
  }

  if (version < 8) {
    // v8: estadísticas. UNA fila por libro, día y modo (leer / escuchar) que se
    // va sumando: un año de lectura diaria son unos pocos miles de filas.
    // El día es LOCAL ("2026-09-23"): leer a las 23:30 cuenta para hoy.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS reading_stats (
        bookId TEXT NOT NULL,
        day TEXT NOT NULL,
        mode TEXT NOT NULL,
        seconds REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (bookId, day, mode)
      );
      CREATE INDEX IF NOT EXISTS idx_reading_stats_day ON reading_stats (day);
    `);
  }

  if (version < 9) {
    // v9: el color de la tapa, para teñir "Seguir leyendo". Se calcula una vez
    // por tapa: NULL = todavía no, 'none' = tapa gris (sin tinte).
    await addColumnIfMissing(db, 'books', 'coverColor', 'TEXT');
  }

  if (version < 10) {
    // v10: limpieza. Se van los restos que nadie lee:
    //  - la tabla sagas y books.sagaId (una jerarquía saga → libro que nunca se
    //    terminó; las sagas de hoy salen de la carpeta, ver utils/series),
    //  - chapters.povCharacter / povNumber (de la etapa con IA; el patrón de
    //    capítulos "BRAN (1)" se sigue detectando, sólo no se guardaba para nada),
    //  - la tabla documents (la biblioteca de antes de books; vacía).
    await cleanUpDeadSchema(db);
  }

  if (version < 11) {
    // v11: cuándo se TERMINÓ cada libro. La meta del año contaba por updatedAt,
    // que cambia en cada guardado: un libro terminado el año pasado sumaba de
    // nuevo al abrirlo, y releer uno terminado lo restaba.
    await addColumnIfMissing(db, 'reading_progress', 'finishedAt', 'TEXT');
    await db.execAsync('UPDATE reading_progress SET finishedAt = updatedAt WHERE finishedAt IS NULL AND percentage >= 99.5');
  }

  if (version < CURRENT_DB_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${CURRENT_DB_VERSION}`);
  }
}

async function hasColumn(db: SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((c) => c.name === column);
}

/**
 * Saca columnas reconstruyendo la tabla: SQLite no deja borrar una columna que
 * es clave foránea (books.sagaId lo era).
 *
 * El orden importa, y es el que pide la documentación de SQLite:
 *  1. Claves foráneas APAGADAS antes de empezar (no se puede dentro de una
 *     transacción). Con ellas prendidas, borrar la tabla vieja de libros borraría
 *     EN CASCADA las notas, el progreso, los capítulos y las colecciones.
 *  2. Todo en una transacción: si algo falla, no cambió nada y user_version no
 *     sube, así que se reintenta en el próximo arranque.
 *  3. Al final se vuelven a prender, pase lo que pase.
 */
async function cleanUpDeadSchema(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await runInTransaction(db, async () => {
      if (await hasColumn(db, 'books', 'sagaId')) {
        await db.execAsync(`
          CREATE TABLE books_v10 (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            orderIndex INTEGER NOT NULL DEFAULT 0,
            uri TEXT NOT NULL,
            type TEXT NOT NULL,
            importedAt TEXT NOT NULL,
            lastOpenedAt TEXT NOT NULL,
            title TEXT,
            author TEXT,
            coverUri TEXT,
            status TEXT NOT NULL DEFAULT 'none',
            favorite INTEGER NOT NULL DEFAULT 0,
            rating INTEGER,
            review TEXT,
            summary TEXT,
            rate REAL,
            voiceId TEXT,
            coverColor TEXT
          );
          INSERT INTO books_v10 (id, name, orderIndex, uri, type, importedAt, lastOpenedAt, title, author,
                                 coverUri, status, favorite, rating, review, summary, rate, voiceId, coverColor)
            SELECT id, name, orderIndex, uri, type, importedAt, lastOpenedAt, title, author,
                   coverUri, status, favorite, rating, review, summary, rate, voiceId, coverColor
            FROM books;
          DROP TABLE books;
          ALTER TABLE books_v10 RENAME TO books;
        `);
      }
      if (await hasColumn(db, 'chapters', 'povCharacter')) {
        await db.execAsync(`
          CREATE TABLE chapters_v10 (
            id TEXT PRIMARY KEY NOT NULL,
            bookId TEXT NOT NULL,
            orderIndex INTEGER NOT NULL,
            title TEXT NOT NULL,
            startChar INTEGER NOT NULL,
            endChar INTEGER NOT NULL,
            FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
          );
          INSERT INTO chapters_v10 (id, bookId, orderIndex, title, startChar, endChar)
            SELECT id, bookId, orderIndex, title, startChar, endChar FROM chapters;
          DROP TABLE chapters;
          ALTER TABLE chapters_v10 RENAME TO chapters;
        `);
      }
      await db.execAsync(`
        DROP TABLE IF EXISTS sagas;
        DROP TABLE IF EXISTS documents;
      `);
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
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
