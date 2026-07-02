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

export const runtimeStateRepository = {
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
