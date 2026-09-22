/**
 * Cuánto te falta para terminar el libro.
 *
 * No se inventa una velocidad "del usuario": se usa una velocidad de lectura
 * razonable y se dice el número con un "~" adelante, que es lo honesto. Un
 * cómic no se mide en caracteres sino en páginas, que es como se lee.
 */

/** Caracteres por minuto de una lectura tranquila en castellano (~200 palabras). */
const CHARS_PER_MINUTE = 1000;
/** Lo que lleva mirar una página de cómic. */
const SECONDS_PER_COMIC_PAGE = 25;
/** Lo que lleva una página de un libro escaneado (no hay texto para contar). */
const SECONDS_PER_SCANNED_PAGE = 90;
/** Menos que esto por página no es texto de verdad: es un PDF escaneado. */
const MIN_CHARS_PER_REAL_PAGE = 100;

export type RemainingInput = {
  /** Largo del texto del libro, si se conoce. */
  textLength?: number | null;
  /** Total de páginas, para los libros que se leen por página. */
  pageCount?: number | null;
  /** Avance de 0 a 100. */
  percentage: number;
  /** Un cómic se mide en páginas aunque tenga texto suelto adentro. */
  isComic?: boolean;
};

/**
 * Minutos que faltan, o null si no hay con qué calcularlo (todavía no se
 * procesó el libro, o ya está terminado).
 */
export function estimateRemainingMinutes(input: RemainingInput): number | null {
  const done = Math.min(Math.max(input.percentage, 0), 100);
  if (!Number.isFinite(done) || done >= 99.5) return null;
  const left = 1 - done / 100;

  const chars = input.textLength ?? 0;
  const pages = input.pageCount ?? 0;
  // Un cómic —y un PDF escaneado, que no tiene texto que contar— se miden en
  // páginas. Sin esto, un escaneo de 4 páginas decía "te falta ~1 min" porque
  // lo único que tenía de "texto" era el relleno provisorio.
  const byPages = input.isComic || (pages > 0 && chars < pages * MIN_CHARS_PER_REAL_PAGE);
  if (byPages) {
    if (pages <= 0) return null;
    const perPage = input.isComic ? SECONDS_PER_COMIC_PAGE : SECONDS_PER_SCANNED_PAGE;
    return Math.ceil((pages * left * perPage) / 60);
  }

  if (chars <= 0) return null;
  return Math.ceil((chars * left) / CHARS_PER_MINUTE);
}

/** "~2 h 40" · "~45 min" · "menos de 1 min". null si no se puede estimar. */
export function formatRemaining(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  // Minutos con dos dígitos: "~36 h 07" se lee; "~36 h 7" parece un error.
  return rest === 0 ? `~${hours} h` : `~${hours} h ${rest.toString().padStart(2, '0')}`;
}

/** Atajo: de los datos del libro al texto listo para mostrar. */
export function remainingLabel(input: RemainingInput): string | null {
  return formatRemaining(estimateRemainingMinutes(input));
}
