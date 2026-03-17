export type StoredDocument = {
  id: string;
  name: string;
  uri: string;
  type: string | null;
  importedAt: string;
  lastOpenedAt: string;
};

export type ReadingProgress = {
  documentId: string;
  blockIndex: number;
  charIndex: number;
  percentage: number;
  updatedAt: string;
};

export type AppSettings = {
  darkMode: boolean;
  fontSize: number;
  defaultRate: number;
  defaultVoiceId: string | null;
  keepScreenAwakeWhileReading: boolean;
  reopenLastDocumentOnLaunch: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  fontSize: 18,
  defaultRate: 0.95,
  defaultVoiceId: null,
  keepScreenAwakeWhileReading: false,
  reopenLastDocumentOnLaunch: false,
};
