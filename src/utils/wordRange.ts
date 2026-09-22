export type WordRange = {
  start: number;
  end: number;
} | null;

// Cualquier letra o número Unicode, más apóstrofo y guión. Antes era un rango
// Latin-1 a mano: en un libro polaco o checo la palabra que suena se cortaba en
// la primera letra fuera del rango ("Kraków" resaltaba sólo "Krak"), y en ruso
// o griego no resaltaba nada.
const WORD_CHARACTER = /[\p{L}\p{N}'-]/u;

export function getWordRangeAt(text: string, charIndex: number): WordRange {
  if (!text) {
    return null;
  }

  let activeIndex = Math.min(Math.max(charIndex, 0), text.length - 1);

  if (!WORD_CHARACTER.test(text[activeIndex] ?? '')) {
    if (WORD_CHARACTER.test(text[activeIndex - 1] ?? '')) {
      activeIndex -= 1;
    } else {
      return null;
    }
  }

  let start = activeIndex;
  let end = activeIndex + 1;

  while (start > 0 && WORD_CHARACTER.test(text[start - 1] ?? '')) {
    start -= 1;
  }

  while (end < text.length && WORD_CHARACTER.test(text[end] ?? '')) {
    end += 1;
  }

  return start === end ? null : { start, end };
}
