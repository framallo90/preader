// === Legacy (mantenido para compatibilidad) ===
export type StoredDocument = {
  id: string;
  name: string;
  uri: string;
  type: string | null;
  importedAt: string;
  lastOpenedAt: string;
};

// === Nuevos tipos: jerarquía Saga → Libro → Capítulo ===

export type Saga = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export type Book = {
  id: string;                // fingerprint de contenido (bk_...)
  sagaId: string | null;     // null si es libro suelto
  name: string;              // nombre de archivo (fallback de display)
  title: string | null;      // título real extraído de la metadata
  author: string | null;     // autor extraído de la metadata
  coverUri: string | null;   // portada extraída, archivo local
  orderIndex: number;
  uri: string;
  type: string;
  importedAt: string;
  lastOpenedAt: string;
};

export type Chapter = {
  id: string;
  bookId: string;
  orderIndex: number;
  title: string;             // "BRAN (1)", "PRÓLOGO", etc.
  povCharacter: string | null; // "BRAN", "CATELYN", null si no es POV
  povNumber: number | null;
  startChar: number;
  endChar: number;
};

export type Character = {
  id: string;
  sagaId: string | null;
  name: string;
  aliases: string[];         // guardado como JSON en SQLite
  house: string | null;
  description: string | null; // generado por Claude
  firstSeenBookId: string | null;
  firstSeenChapterId: string | null;
  updatedAt: string;
};

export type ChapterContext = {
  chapterId: string;
  beforeSummary: string | null;   // qué recordar antes de leer
  afterSummary: string | null;    // resumen al terminar
  characters: string[];           // nombres de personajes que aparecen
  keyEvents: string[];            // eventos importantes
  extractedAt: string;
};

export type ReadingProgress = {
  bookId: string;
  chapterId: string | null;
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
  /** Carpetas SAF autorizadas que se escanean en busca de libros. */
  libraryFolders: string[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  fontSize: 18,
  defaultRate: 0.95,
  defaultVoiceId: null,
  keepScreenAwakeWhileReading: false,
  reopenLastDocumentOnLaunch: false,
  libraryFolders: [],
};
