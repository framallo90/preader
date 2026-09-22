/**
 * Búsqueda dentro del libro, sin distinguir mayúsculas ni tildes ("camion"
 * encuentra "camión") y, cuando se puede, por raíz de la palabra ("correr"
 * encuentra "corriendo").
 */
import { hasUsefulStem, wordStem } from './wordStem';

export type SearchMatch = {
  /** Offset del match dentro del texto completo. */
  index: number;
  /** Fragmento alrededor del match, para mostrar en la lista de resultados. */
  snippet: string;
  /** Dónde cae el match dentro del snippet (para resaltarlo). */
  snippetMatchStart: number;
  matchLength: number;
};

const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 90;

// Tabla de plegado para Latin-1 y Latin Extended-A (U+00C0–U+017F): cubre
// castellano, portugués, francés, alemán, italiano, catalán, polaco, checo…
// Se arma UNA vez con normalize(); después plegar es un lookup por código.
// Antes se llamaba normalize('NFD') por cada carácter acentuado del libro y se
// concatenaba con `+=`: la primera búsqueda en un tomo grande congelaba la
// pantalla más de un segundo, justo sobre el toque del usuario.
const FOLD_FROM = 0x00c0;
const FOLD_TO = 0x017f;
// Letras con trazo o barra: NFD no las descompone (no son acentos), así que hay
// que decir a mano a qué letra equivalen. Solo las que ocupan un carácter: "ß"
// sería "ss" y correría todos los offsets.
const STROKE_LETTERS: Record<string, string> = {
  'ł': 'l', 'đ': 'd', 'ø': 'o', 'ħ': 'h', 'ŧ': 't', 'ı': 'i', 'ð': 'd',
};

const FOLDED_RANGE = (() => {
  const table = new Array<string>(FOLD_TO - FOLD_FROM + 1);
  for (let code = FOLD_FROM; code <= FOLD_TO; code++) {
    const char = String.fromCharCode(code);
    const lower = char.toLowerCase();
    const base = char.normalize('NFD')[0].toLowerCase();
    // Solo sirve si el plegado ocupa UN carácter: el índice tiene que seguir valiendo.
    const folded = base.length === 1 ? base : lower;
    table[code - FOLD_FROM] = STROKE_LETTERS[folded] ?? folded;
  }
  return table;
})();

/**
 * Versión "plegada" del texto, carácter por carácter: MISMO largo que el
 * original, así un índice en el plegado es un índice válido en el original.
 * (Normalizar el string entero con NFD cambiaría el largo y correría los offsets.)
 */
export function foldText(text: string): string {
  // Se acumula en trozos y se une al final: concatenar en un solo string va
  // multiplicando copias a medida que crece.
  const parts: string[] = [];
  const buffer = new Array<string>(4096);
  let used = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let folded: string;
    if (code < 128) {
      folded = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
    } else if (code >= FOLD_FROM && code <= FOLD_TO) {
      folded = FOLDED_RANGE[code - FOLD_FROM];
    } else {
      const base = text[i].normalize('NFD')[0].toLowerCase();
      folded = base.length === 1 ? base : text[i];
    }
    buffer[used++] = folded;
    if (used === buffer.length) {
      parts.push(buffer.join(''));
      used = 0;
    }
  }
  if (used > 0) parts.push(buffer.slice(0, used).join(''));
  return parts.length === 1 ? parts[0] : parts.join('');
}

/** ¿Este carácter forma parte de una palabra? (para pegarse al comienzo). */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/**
 * Busca dentro del libro.
 *
 * Si la palabra buscada tiene una terminación reconocible ("correr", "cantaba"),
 * además busca por su RAÍZ al comienzo de palabra, así "correr" encuentra
 * "corriendo" y "corrieron". Si no la tiene, se comporta exactamente como antes:
 * una búsqueda de texto común. O sea, esto solo suma resultados.
 */
export function searchText(text: string, query: string, limit = 200, foldedText?: string): SearchMatch[] {
  const needle = foldText(query.trim());
  if (needle.length < 2) return [];

  const haystack = foldedText ?? foldText(text);
  // Buscar por raíz solo tiene sentido en una palabra sola: en una frase, la
  // gente espera encontrar esa frase.
  const singleWord = !needle.includes(' ');
  const stem = singleWord && hasUsefulStem(needle) ? wordStem(needle) : null;
  const target = stem ?? needle;
  const matches: SearchMatch[] = [];
  let from = 0;

  while (matches.length < limit) {
    const index = haystack.indexOf(target, from);
    if (index < 0) break;

    // Con raíz: tiene que ser el COMIENZO de una palabra, no cualquier pedazo.
    if (stem && isWordChar(haystack[index - 1])) {
      from = index + 1;
      continue;
    }
    // Y el resaltado cubre la palabra entera, no solo la raíz.
    let matchLength = target.length;
    if (stem) {
      while (isWordChar(haystack[index + matchLength])) matchLength += 1;
    }

    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + matchLength + SNIPPET_AFTER);
    const prefix = start > 0 ? '…' : '';
    const rawBefore = text.slice(start, index).replace(/\s+/g, ' ');
    const rawMatch = text.slice(index, index + matchLength).replace(/\s+/g, ' ');
    const rawAfter = text.slice(index + matchLength, end).replace(/\s+/g, ' ');

    matches.push({
      index,
      snippet: `${prefix}${rawBefore}${rawMatch}${rawAfter}${end < text.length ? '…' : ''}`,
      snippetMatchStart: prefix.length + rawBefore.length,
      matchLength: rawMatch.length,
    });
    from = index + matchLength;
  }

  return matches;
}
