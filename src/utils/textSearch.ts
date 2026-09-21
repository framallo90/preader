/**
 * Búsqueda dentro del libro, sin distinguir mayúsculas ni tildes ("camion"
 * encuentra "camión").
 */
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

/**
 * Versión "plegada" del texto, carácter por carácter: MISMO largo que el
 * original, así un índice en el plegado es un índice válido en el original.
 * (Normalizar el string entero con NFD cambiaría el largo y correría los offsets.)
 */
export function foldText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char;
      continue;
    }
    const base = char.normalize('NFD')[0].toLowerCase();
    out += base.length === 1 ? base : char;
  }
  return out;
}

export function searchText(text: string, query: string, limit = 200, foldedText?: string): SearchMatch[] {
  const needle = foldText(query.trim());
  if (needle.length < 2) return [];

  const haystack = foldedText ?? foldText(text);
  const matches: SearchMatch[] = [];
  let from = 0;

  while (matches.length < limit) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;

    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + needle.length + SNIPPET_AFTER);
    const prefix = start > 0 ? '…' : '';
    const rawBefore = text.slice(start, index).replace(/\s+/g, ' ');
    const rawMatch = text.slice(index, index + needle.length).replace(/\s+/g, ' ');
    const rawAfter = text.slice(index + needle.length, end).replace(/\s+/g, ' ');

    matches.push({
      index,
      snippet: `${prefix}${rawBefore}${rawMatch}${rawAfter}${end < text.length ? '…' : ''}`,
      snippetMatchStart: prefix.length + rawBefore.length,
      matchLength: rawMatch.length,
    });
    from = index + needle.length;
  }

  return matches;
}
