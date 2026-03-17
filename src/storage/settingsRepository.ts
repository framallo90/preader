import { getDatabase } from './database';
import { AppSettings, DEFAULT_SETTINGS } from '../types/storage';

type SettingsRow = {
  key: string;
  value: string;
};

type AppSettingKey = keyof AppSettings;

function parseValue<Key extends AppSettingKey>(key: Key, value: string): AppSettings[Key] {
  try {
    return JSON.parse(value) as AppSettings[Key];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export const settingsRepository = {
  async loadSettings() {
    const db = await getDatabase();
    const rows = await db.getAllAsync<SettingsRow>('SELECT key, value FROM settings');
    const nextSettings: AppSettings = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      if (row.key === 'darkMode') {
        nextSettings.darkMode = parseValue('darkMode', row.value);
      }

      if (row.key === 'fontSize') {
        nextSettings.fontSize = parseValue('fontSize', row.value);
      }

      if (row.key === 'defaultRate') {
        nextSettings.defaultRate = parseValue('defaultRate', row.value);
      }

      if (row.key === 'defaultVoiceId') {
        nextSettings.defaultVoiceId = parseValue('defaultVoiceId', row.value);
      }

      if (row.key === 'keepScreenAwakeWhileReading') {
        nextSettings.keepScreenAwakeWhileReading = parseValue(
          'keepScreenAwakeWhileReading',
          row.value,
        );
      }

      if (row.key === 'reopenLastDocumentOnLaunch') {
        nextSettings.reopenLastDocumentOnLaunch = parseValue(
          'reopenLastDocumentOnLaunch',
          row.value,
        );
      }
    }

    return nextSettings;
  },

  async saveSettings(patch: Partial<AppSettings>) {
    const entries = Object.entries(patch) as Array<[AppSettingKey, AppSettings[AppSettingKey]]>;

    if (entries.length === 0) {
      return;
    }

    const db = await getDatabase();

    await db.withTransactionAsync(async () => {
      for (const [key, value] of entries) {
        await db.runAsync(
          `
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `,
          [key, JSON.stringify(value)],
        );
      }
    });
  },
};
