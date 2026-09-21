// === Legacy (mantenido para compatibilidad) ===
export type StoredDocument = {
  id: string;
  name: string;
  uri: string;
  type: string | null;
  importedAt: string;
  lastOpenedAt: string;
};

/** Lista de lectura del libro (como "To Read" / "Have Read" de ReadEra). */
export type BookStatus = 'none' | 'to_read' | 'read';

/** Campos de un libro recién importado (los edita el usuario después). */
export const NEW_BOOK_DEFAULTS = {
  status: 'none' as BookStatus,
  favorite: false,
  rating: null,
  review: null,
};

export type NoteType = 'bookmark' | 'quote' | 'note';

/** Marcador, cita o nota. La posición es el offset de carácter en el texto. */
export type BookNote = {
  id: string;
  bookId: string;
  type: NoteType;
  charIndex: number;
  page: number | null;       // solo para mostrar (PDF)
  body: string | null;       // texto citado
  comment: string | null;    // lo que escribió el usuario
  createdAt: string;
  updatedAt: string;
};

export type Collection = {
  id: string;
  name: string;
  createdAt: string;
  bookCount: number;
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
  status: BookStatus;
  favorite: boolean;
  rating: number | null;     // 1-5 estrellas, null sin calificar
  review: string | null;     // reseña propia
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
  /** Subcarpetas que el escaneo saltea (ruta SAF decodificada, p. ej. "primary:Libros/Viejos"). */
  excludedFolders: string[];
  /** Tema del lector: 'auto' sigue al modo oscuro. */
  readingTheme: ReadingTheme;
  /** Recortar los márgenes blancos de los PDF. */
  cropPdfMargins: boolean;
  /** Atenuación extra sobre el lector (0-0.8): brillo por debajo del mínimo del sistema. */
  screenDim: number;
};

export type ReadingTheme = 'auto' | 'day' | 'sepia' | 'night';

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  fontSize: 18,
  defaultRate: 0.95,
  defaultVoiceId: null,
  keepScreenAwakeWhileReading: false,
  reopenLastDocumentOnLaunch: false,
  libraryFolders: [],
  excludedFolders: [],
  readingTheme: 'auto',
  cropPdfMargins: true,
  screenDim: 0,
};
