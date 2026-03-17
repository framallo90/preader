export type WordRange = {
  start: number;
  end: number;
} | null;

const WORD_CHARACTER = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'-]/;

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
