import { getDatabase } from './database';

type ReaderLoadGuard = {
  documentId: string;
  startedAt: string;
};

type SettingsRow = {
  key: string;
  value: string;
};

const READER_LOAD_GUARD_KEY = 'runtime.readerLoadGuard';

function parseGuard(value: string): ReaderLoadGuard | null {
  try {
    const parsed = JSON.parse(value) as Partial<ReaderLoadGuard>;

    if (
      !parsed ||
      typeof parsed.documentId !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }

    return {
      documentId: parsed.documentId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

// El arranque anterior encontró un guard armado: la app se cerró cargando ese
// libro. Se recuerda en memoria para que "reabrir el último libro al iniciar"
// no lo vuelva a abrir solo (era un bucle de cierres sin salida).
let bootRecovered = false;

export const runtimeStateRepository = {
  markBootRecovered() {
    bootRecovered = true;
  },

  wasBootRecovered() {
    return bootRecovered;
  },

  async getReaderLoadGuard() {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SettingsRow>(
      'SELECT key, value FROM settings WHERE key = ?',
      [READER_LOAD_GUARD_KEY],
    );

    return row ? parseGuard(row.value) : null;
  },

  async armReaderLoadGuard(documentId: string) {
    const db = await getDatabase();

    await db.runAsync(
      `
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      [
        READER_LOAD_GUARD_KEY,
        JSON.stringify({
          documentId,
          startedAt: new Date().toISOString(),
        } satisfies ReaderLoadGuard),
      ],
    );
  },

  async clearReaderLoadGuard() {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM settings WHERE key = ?', [READER_LOAD_GUARD_KEY]);
  },
};
