/**
 * Detección de idioma por palabras vacías (stopwords). Sirve para elegir una voz
 * del idioma del libro: una voz española leyendo un libro en inglés es la causa
 * más común de que el TTS del sistema "suene horrible".
 */
const STOPWORDS: Record<string, string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'con', 'para', 'no', 'se', 'su', 'del', 'al', 'lo', 'como', 'pero', 'más', 'era', 'había', 'muy', 'también', 'cuando', 'porque', 'hasta', 'desde'],
  en: ['the', 'of', 'and', 'to', 'in', 'a', 'is', 'that', 'it', 'was', 'for', 'on', 'with', 'as', 'he', 'his', 'be', 'at', 'by', 'had', 'not', 'but', 'from', 'they', 'she', 'her', 'were', 'which', 'this', 'have'],
  pt: ['o', 'a', 'os', 'as', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'se', 'na', 'no', 'por', 'mais', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'seu', 'sua'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'en', 'un', 'une', 'du', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'au', 'avec', 'ce', 'il', 'elle', 'ne', 'se', 'plus', 'par', 'était', 'mais', 'nous', 'vous', 'son'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'che', 'e', 'in', 'un', 'una', 'per', 'con', 'non', 'si', 'del', 'della', 'dei', 'al', 'come', 'ma', 'più', 'era', 'sono', 'anche', 'nel', 'alla', 'suo', 'sua'],
  de: ['der', 'die', 'das', 'und', 'in', 'den', 'von', 'zu', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch', 'es', 'an', 'er', 'sie', 'war', 'aus', 'wie', 'aber', 'nach'],
};

const SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words)]),
) as Record<string, Set<string>>;

const SLICE_CHARS = 4000;
const MIN_HITS = 25;

/** Toma muestras del inicio, medio y final: el arranque suele ser portada/índice. */
function sampleText(text: string): string {
  if (text.length <= SLICE_CHARS * 3) return text;
  const at = (ratio: number) => {
    const start = Math.floor(text.length * ratio);
    return text.slice(start, start + SLICE_CHARS);
  };
  return `${at(0.1)} ${at(0.5)} ${at(0.8)}`;
}

/** Devuelve el idioma ('es', 'en', …) o null si no hay evidencia suficiente. */
export function detectLanguage(text: string): string | null {
  const words = sampleText(text).toLowerCase().match(/\p{L}+/gu);
  if (!words || words.length === 0) return null;

  const hits: Record<string, number> = {};
  for (const lang of Object.keys(SETS)) hits[lang] = 0;
  for (const word of words) {
    for (const lang of Object.keys(SETS)) {
      if (SETS[lang].has(word)) hits[lang] += 1;
    }
  }

  const ranked = Object.entries(hits).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < MIN_HITS) return null;
  // Español/portugués/italiano comparten muchas palabras: se exige margen.
  if (second && best[1] < second[1] * 1.15) return null;
  return best[0];
}
