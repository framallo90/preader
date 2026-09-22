/**
 * Arma el texto del libro a partir del texto crudo de cada página y registra
 * dónde empieza cada una (pageOffsets): ese mapa es lo que permite saber en qué
 * página va la voz y qué página corresponde al progreso guardado.
 *
 * Dos cuidados pensados para la narración:
 *  - Encabezados y pies repetidos (título del libro, autor) se descartan: si no,
 *    la voz los lee en cada página.
 *  - Un párrafo que continúa en la página siguiente se une con un espacio. Con
 *    un salto de párrafo la voz haría una pausa falsa en cada cambio de página.
 */
export type JoinedPdfText = {
  fullText: string;
  /** Un offset por página (mismo largo que rawPages). */
  pageOffsets: number[];
};

const MIN_REPEATS = 6;
const MIN_REPEAT_RATIO = 0.15;
const MAX_RUNNING_LINE_LENGTH = 80;

/**
 * Clave de comparación: SOLO las letras, en minúscula. Se ignoran dígitos (el
 * número de página cambia), espacios y signos, porque en un PDF escaneado el OCR
 * lee el mismo encabezado de varias formas ("MEDITACIONES 41", "MEDITA CIO NES").
 */
function runningLineKey(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}]/gu, '');
}

/** Distancia de edición, con corte temprano si supera `max`. */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

const MIN_FUZZY_KEY_LENGTH = 8;

/**
 * ¿La línea es uno de los encabezados repetidos? Igual exacto, o casi igual si el
 * encabezado es lo bastante largo: el OCR mete ruido ("MEDITACIONES i%",
 * "y- ORTEGA Y GASSET" por "J. ORTEGA Y GASSET").
 */
function matchesRunningLine(key: string, running: Set<string>): boolean {
  if (running.has(key)) return true;
  for (const known of running) {
    if (known.length < MIN_FUZZY_KEY_LENGTH) continue;
    const tolerance = Math.max(2, Math.floor(known.length * 0.15));
    if (editDistanceWithin(key, known, tolerance)) return true;
  }
  return false;
}

function edgeLines(page: string): { first: string | null; last: string | null } {
  const lines = page.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { first: null, last: null };
  return { first: lines[0], last: lines.length > 1 ? lines[lines.length - 1] : null };
}

/** Líneas que se repiten como primera o última de muchas páginas. */
export function findRunningLines(rawPages: string[]): Set<string> {
  const counts = new Map<string, number>();
  let pagesWithText = 0;

  for (const page of rawPages) {
    const { first, last } = edgeLines(page);
    if (first === null) continue;
    pagesWithText += 1;
    const keys = new Set<string>();
    for (const line of [first, last]) {
      if (!line || line.length > MAX_RUNNING_LINE_LENGTH) continue;
      const key = runningLineKey(line);
      if (key.length >= 3) keys.add(key);
    }
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(MIN_REPEATS, Math.ceil(pagesWithText * MIN_REPEAT_RATIO));
  const running = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= threshold) running.add(key);
  }
  return running;
}

function stripRunningLines(page: string, running: Set<string>): string {
  if (running.size === 0) return page;
  const lines = page.split('\n');
  const isRunning = (line: string) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_RUNNING_LINE_LENGTH && matchesRunningLine(runningLineKey(trimmed), running);
  };

  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (start < lines.length && isRunning(lines[start])) lines[start] = '';

  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  if (end > start && isRunning(lines[end])) lines[end] = '';

  return lines.join('\n');
}

// Cuánto del final del texto hace falta mirar para decidir la unión de páginas.
const TAIL_CHARS = 48;
const SENTENCE_END = /[.!?…:;]["'»”’)\]]*$/;
const STARTS_LOWERCASE = /^\p{Ll}/u;
const ENDS_HYPHENATED = /\p{L}-$/u;

/**
 * @param rawPages texto crudo por página (el índice ES el número de página)
 * @param clean    limpieza de texto que ya usa el resto de la app
 */
function createPageJoiner() {
  // Se acumula en partes y se une UNA vez al final. Y para decidir cómo pegar una
  // página solo se mira la COLA del texto. La primera versión hacía
  // `regex.test(fullText)` y `fullText += …` en cada página: lineal en el largo
  // acumulado, o sea cuadrático en el libro. En V8 no se notaba; en Hermes (el
  // motor del teléfono) 1.500 páginas tardaban 30 s y un libro grande, minutos.
  const parts: string[] = [];
  let length = 0;
  let tail = '';
  const pageOffsets: number[] = [];

  const push = (piece: string) => {
    parts.push(piece);
    length += piece.length;
    tail = (tail + piece).slice(-TAIL_CHARS);
  };

  const add = (cleaned: string) => {
    if (cleaned && length > 0) {
      const continuesParagraph = !SENTENCE_END.test(tail) && STARTS_LOWERCASE.test(cleaned);
      if (continuesParagraph && ENDS_HYPHENATED.test(tail)) {
        // Palabra cortada por el cambio de página: se saca el guión del final.
        const last = parts.length - 1;
        parts[last] = parts[last].slice(0, -1);
        length -= 1;
        tail = tail.slice(0, -1);
      } else if (continuesParagraph) {
        push(' ');
      } else {
        push('\n\n');
      }
    }

    pageOffsets.push(length);
    if (cleaned) push(cleaned);
  };

  const finish = (): JoinedPdfText => ({ fullText: parts.join(''), pageOffsets });
  return { add, finish };
}

export function joinPdfPages(rawPages: string[], clean: (raw: string) => string): JoinedPdfText {
  const running = findRunningLines(rawPages);
  const joiner = createPageJoiner();
  for (const rawPage of rawPages) {
    joiner.add(clean(stripRunningLines(String(rawPage ?? ''), running)));
  }
  return joiner.finish();
}

/**
 * Igual que joinPdfPages, pero cede el hilo cada tantas páginas. Se usa cuando el
 * texto se prepara de fondo con el libro ya abierto: limpiar miles de páginas de
 * un tirón congelaba la pantalla mientras el usuario leía.
 */
export async function joinPdfPagesAsync(
  rawPages: string[],
  clean: (raw: string) => string,
  pause: () => Promise<void>,
  pagesPerSlice = 40,
): Promise<JoinedPdfText> {
  const running = findRunningLines(rawPages);
  await pause();
  const joiner = createPageJoiner();
  for (let index = 0; index < rawPages.length; index++) {
    joiner.add(clean(stripRunningLines(String(rawPages[index] ?? ''), running)));
    if (index % pagesPerSlice === pagesPerSlice - 1) await pause();
  }
  return joiner.finish();
}

/**
 * PDF escaneado (sin texto): una línea por página. Así cada página tiene su
 * propio offset y siguen funcionando el progreso, los marcadores y el salto a
 * página, aunque no haya nada para leer en voz alta.
 */
export function buildPagePlaceholders(pageCount: number): JoinedPdfText {
  let fullText = '';
  const pageOffsets: number[] = [];
  for (let page = 0; page < pageCount; page++) {
    if (fullText) fullText += '\n\n';
    pageOffsets.push(fullText.length);
    fullText += `Página ${page + 1}`;
  }
  return { fullText, pageOffsets };
}
