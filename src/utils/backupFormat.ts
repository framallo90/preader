import { AppSettings, Book, BookNote, ReadingProgress } from '../types/storage';

/**
 * Formato del respaldo de tus datos.
 *
 * Qué entra y qué no: entra **lo que no se puede regenerar** — lo que leíste,
 * lo que anotaste, cómo ordenaste y qué marcaste. No entran ni los libros ni
 * las tapas ni el texto ya procesado: los archivos son tuyos y ya los tenés, y
 * lo demás se vuelve a generar solo. Así el respaldo pesa kilobytes.
 *
 * La pieza que hace que esto sirva de verdad es el **id**, que es la huella del
 * CONTENIDO del archivo. Al restaurar en otro teléfono, un libro se reconoce
 * aunque esté en otra carpeta y con otro nombre.
 *
 * Todo lo de acá es lógica pura, sin base ni archivos: se puede probar.
 */

export const BACKUP_VERSION = 1;

/** Sólo lo que no se regenera solo. */
export type BackupBook = Pick<
  Book,
  'id' | 'name' | 'title' | 'author' | 'summary' | 'status' | 'favorite' | 'rating' | 'review' | 'orderIndex' | 'rate' | 'voiceId'
>;

export type BackupNote = Pick<BookNote, 'id' | 'bookId' | 'type' | 'charIndex' | 'page' | 'body' | 'comment' | 'createdAt' | 'updatedAt'>;

export type BackupProgress = Pick<
  ReadingProgress,
  'bookId' | 'chapterId' | 'blockIndex' | 'charIndex' | 'percentage' | 'page' | 'textLength' | 'updatedAt'
>;

export type BackupCollection = { id: string; name: string; bookIds: string[] };

export type BackupFile = {
  app: 'bardo';
  version: number;
  exportedAt: string;
  books: BackupBook[];
  progress: BackupProgress[];
  notes: BackupNote[];
  collections: BackupCollection[];
  settings: Partial<AppSettings>;
};

/** Ajustes que NO viajan: son de este teléfono, no tuyos. */
const DEVICE_ONLY_SETTINGS = new Set(['libraryFolders', 'excludedFolders', 'defaultVoiceId']);

/**
 * Los ajustes que tiene sentido llevarse.
 *
 * Las carpetas de la biblioteca quedan afuera a propósito: son permisos SAF de
 * ESTE teléfono y en otro no significan nada. La voz también, porque las voces
 * instaladas cambian de aparato a aparato y una voz inexistente deja la
 * narración muda.
 */
export function portableSettings(settings: AppSettings): Partial<AppSettings> {
  const salida: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (DEVICE_ONLY_SETTINGS.has(key)) continue;
    salida[key] = value;
  }
  return salida as Partial<AppSettings>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

const isBackupBook = (v: unknown): v is BackupBook => isObject(v) && typeof v.id === 'string' && v.id.length > 0;
const isBackupNote = (v: unknown): v is BackupNote =>
  isObject(v) && typeof v.id === 'string' && typeof v.bookId === 'string' && typeof v.charIndex === 'number';
const isBackupProgress = (v: unknown): v is BackupProgress =>
  isObject(v) && typeof v.bookId === 'string' && typeof v.blockIndex === 'number';
const isBackupCollection = (v: unknown): v is BackupCollection =>
  isObject(v) && typeof v.id === 'string' && typeof v.name === 'string';

/**
 * Lee un archivo de respaldo, descartando lo que esté roto en vez de fallar.
 *
 * Un archivo tocado a mano, cortado a la mitad o de una versión futura no debe
 * dejarte sin restaurar NADA: se toma todo lo que sea válido. Devuelve null
 * sólo si ni siquiera es un respaldo de Bardo.
 */
export function parseBackup(raw: string): BackupFile | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || data.app !== 'bardo') return null;

  return {
    app: 'bardo',
    version: typeof data.version === 'number' ? data.version : BACKUP_VERSION,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    books: asArray(data.books, isBackupBook),
    progress: asArray(data.progress, isBackupProgress),
    notes: asArray(data.notes, isBackupNote),
    collections: asArray(data.collections, isBackupCollection).map((c) => ({
      ...c,
      bookIds: Array.isArray(c.bookIds) ? c.bookIds.filter((id): id is string => typeof id === 'string') : [],
    })),
    settings: isObject(data.settings) ? (portableSettings(data.settings as AppSettings) as Partial<AppSettings>) : {},
  };
}

export type RestorePlan<T> = { apply: T[]; skipped: number };

/**
 * Qué del respaldo corresponde aplicar, sabiendo qué libros hay en este teléfono.
 *
 * Lo de un libro que todavía no agregaste se saltea: restaurar su progreso
 * crearía una fila huérfana, y cuando aparezca el libro (misma huella) se puede
 * volver a importar. Se informa cuántos quedaron afuera, para poder decirlo.
 */
export function planRestore<T extends { bookId: string }>(items: T[], knownBookIds: Set<string>): RestorePlan<T> {
  const apply: T[] = [];
  let skipped = 0;
  for (const item of items) {
    if (knownBookIds.has(item.bookId)) apply.push(item);
    else skipped += 1;
  }
  return { apply, skipped };
}

/**
 * ¿Gana el progreso del respaldo o el que ya está en el teléfono?
 *
 * Gana el más nuevo. Restaurar a ciegas podría pisar con una posición vieja un
 * libro que seguiste leyendo después de exportar.
 */
export function shouldReplaceProgress(existing: { updatedAt: string } | null, incoming: { updatedAt: string }): boolean {
  if (!existing) return true;
  const a = Date.parse(existing.updatedAt);
  const b = Date.parse(incoming.updatedAt);
  if (!Number.isFinite(b)) return false;
  if (!Number.isFinite(a)) return true;
  return b > a;
}
