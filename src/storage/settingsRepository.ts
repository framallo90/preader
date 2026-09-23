import { getDatabase } from './database';
import { AppSettings, AUTO_SCROLL_SPEEDS, DEFAULT_SETTINGS, LIBRARY_SORTS, LibrarySort, MAX_TEXT_MARGIN, MIN_TEXT_MARGIN } from '../types/storage';

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

      if (row.key === 'excludedFolders') {
        const parsed = parseValue('excludedFolders', row.value);
        nextSettings.excludedFolders = Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : [];
      }

      if (row.key === 'readingTheme') {
        const parsed = parseValue('readingTheme', row.value);
        nextSettings.readingTheme = ['auto', 'day', 'sepia', 'night'].includes(parsed) ? parsed : 'auto';
      }

      if (row.key === 'cropPdfMargins') {
        nextSettings.cropPdfMargins = parseValue('cropPdfMargins', row.value) !== false;
      }

      if (row.key === 'screenDim') {
        const parsed = Number(parseValue('screenDim', row.value));
        nextSettings.screenDim = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 0.8) : 0;
      }

      if (row.key === 'fontFamily') {
        const parsed = parseValue('fontFamily', row.value);
        nextSettings.fontFamily = parsed === 'serif' ? 'serif' : 'sans';
      }

      if (row.key === 'lineHeight') {
        const parsed = Number(parseValue('lineHeight', row.value));
        nextSettings.lineHeight = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1.3), 2.0) : DEFAULT_SETTINGS.lineHeight;
      }

      if (row.key === 'justifyText') {
        nextSettings.justifyText = parseValue('justifyText', row.value) === true;
      }

      if (row.key === 'pdfAsText') {
        nextSettings.pdfAsText = parseValue('pdfAsText', row.value) === true;
      }

      if (row.key === 'tapEdgesTurnPage') {
        nextSettings.tapEdgesTurnPage = parseValue('tapEdgesTurnPage', row.value) === true;
      }

      if (row.key === 'autoScrollSpeed') {
        const parsed = parseValue('autoScrollSpeed', row.value);
        if (typeof parsed === 'number' && AUTO_SCROLL_SPEEDS.includes(parsed)) {
          nextSettings.autoScrollSpeed = parsed;
        }
      }

      if (row.key === 'horizontalPages') {
        nextSettings.horizontalPages = parseValue('horizontalPages', row.value) === true;
      }

      if (row.key === 'volumeKeysTurnPage') {
        nextSettings.volumeKeysTurnPage = parseValue('volumeKeysTurnPage', row.value) === true;
      }

      if (row.key === 'announceChapters') {
        nextSettings.announceChapters = parseValue('announceChapters', row.value) !== false;
      }

      if (row.key === 'textMargin') {
        const parsed = parseValue('textMargin', row.value);
        if (typeof parsed === 'number' && Number.isFinite(parsed)) {
          nextSettings.textMargin = Math.min(Math.max(parsed, MIN_TEXT_MARGIN), MAX_TEXT_MARGIN);
        }
      }

      if (row.key === 'librarySort') {
        const parsed = parseValue('librarySort', row.value);
        nextSettings.librarySort = LIBRARY_SORTS.includes(parsed as LibrarySort) ? (parsed as LibrarySort) : 'recent';
      }

      if (row.key === 'libraryFolders') {
        const parsed = parseValue('libraryFolders', row.value);
        nextSettings.libraryFolders = Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : [];
      }
    }

    return nextSettings;
  },

  async saveSettings(patch: Partial<AppSettings>) {
    const entries = Object.entries(patch) as [AppSettingKey, AppSettings[AppSettingKey]][];

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
