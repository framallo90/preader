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
  // 0 = sin ordenar a mano. Va al final de su carpeta, así un libro que aparece
  // en un escaneo nuevo no se mete arriba del orden que vos armaste.
  orderIndex: 0,
  rate: null,
  voiceId: null,
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

export type Book = {
  id: string;                // fingerprint de contenido (bk_...)
  name: string;              // nombre de archivo (fallback de display)
  title: string | null;      // título real extraído de la metadata
  author: string | null;     // autor extraído de la metadata
  coverUri: string | null;   // portada extraída, archivo local
  summary: string | null;    // de qué va: del archivo, del texto, o escrita por vos
  uri: string;
  type: string;
  importedAt: string;
  lastOpenedAt: string;
  status: BookStatus;
  favorite: boolean;
  rating: number | null;     // 1-5 estrellas, null sin calificar
  review: string | null;     // reseña propia
  /**
   * Tu orden a mano dentro de la carpeta. 0 = nunca lo ordenaste.
   *
   * Se guardan espaciados (1000, 2000, 3000…) para que mover un libro reescriba
   * un puñado de filas y no la carpeta entera.
   */
  orderIndex: number;
  /** Velocidad propia de este libro; null = la general de Ajustes. */
  rate: number | null;
  /** Voz propia de este libro; null = la general de Ajustes. */
  voiceId: string | null;
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
  /** Página (PDF, cómic) en la que quedó la lectura; null en libros de texto. */
  page: number | null;
  /**
   * Largo del texto sobre el que se midieron blockIndex/charIndex. Si no coincide
   * con el del documento abierto (texto todavía en preparación, libro re-procesado
   * por una versión nueva) esos offsets no valen y manda la página.
   */
  textLength: number | null;
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
  /** Tipografía del modo texto. */
  fontFamily: ReaderFontFamily;
  /** Interlineado como múltiplo del tamaño de letra (1.3–2.0). */
  lineHeight: number;
  justifyText: boolean;
  /** Leer los PDF con texto como texto corrido (reflow) en vez de por páginas. */
  pdfAsText: boolean;
  /** Tocar los bordes de la pantalla pasa de página (el centro sigue siendo pantalla completa). */
  tapEdgesTurnPage: boolean;
  /** Margen lateral del modo texto, en puntos (8–56). */
  textMargin: number;
  /** Velocidad del auto-scroll en puntos por segundo; 0 = apagado. */
  autoScrollSpeed: number;
  /** Pasar de página de costado (una por vez) en vez de scrollear en vertical. */
  horizontalPages: boolean;
  /** Los botones de volumen pasan de página mientras hay un libro abierto. */
  volumeKeysTurnPage: boolean;
  /** Decir "Capítulo 3. El cuaderno" antes de empezar a leer un capítulo. */
  announceChapters: boolean;
  /** Cómo tiene que decir la voz ciertas palabras: [{ from: 'Qhorin', to: 'Corin' }]. */
  pronunciations: { from: string; to: string }[];
  /** Cuántos libros querés terminar este año; 0 = sin meta. */
  yearlyGoal: number;
  /** Orden de la biblioteca. */
  librarySort: LibrarySort;
  /** Cómo se ve la biblioteca: grilla de tapas o lista con autor y avance. */
  libraryLayout: LibraryLayout;
};

export type ReadingTheme = 'auto' | 'day' | 'sepia' | 'night';
export type ReaderFontFamily = 'sans' | 'serif';
/**
 * Los órdenes de la biblioteca. La LISTA es la fuente de verdad y el tipo sale
 * de ella: así el validador que lee los ajustes no puede quedar desactualizado.
 * (Pasó: se agregó 'manual' al tipo pero no a la lista blanca del repositorio,
 * y al reiniciar la app el orden elegido se descartaba en silencio.)
 */
export const LIBRARY_SORTS = ['recent', 'title', 'author', 'manual'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const LIBRARY_LAYOUTS = ['grid', 'list'] as const;
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number];

/** Margen lateral del modo texto: de casi pegado al borde a una columna angosta. */
/** Auto-scroll: de un renglón cada par de segundos a lectura rápida. */
export const AUTO_SCROLL_SPEEDS = [0, 10, 20, 35, 60, 100];

export const MIN_TEXT_MARGIN = 8;
export const MAX_TEXT_MARGIN = 56;
export const TEXT_MARGIN_STEP = 8;

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
  fontFamily: 'sans',
  lineHeight: 1.68,
  justifyText: false,
  pdfAsText: false,
  tapEdgesTurnPage: true,
  textMargin: 16,
  autoScrollSpeed: 0,
  horizontalPages: false,
  volumeKeysTurnPage: false,
  announceChapters: true,
  pronunciations: [],
  yearlyGoal: 0,
  librarySort: 'recent',
  libraryLayout: 'grid',
};
