/**
 * Limpieza y normalización del texto extraído.
 * PORT del pipeline del cliente (src/utils/chapterDetector.ts + textBlocks.ts):
 * si se cambia una regla acá, cambiarla también allá para que el texto del
 * paquete sea idéntico al que la app generaría localmente.
 */

const POV_CHAPTER_PATTERN = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{1,30})\t\((\d+)\)$/;
const SPECIAL_CHAPTER_PATTERN = /^(PRÓLOGO|EPÍLOGO|PREFACIO|PRESENTACIÓN|INTRODUCCIÓN)$/;
const HYPHENATED_LINE_BREAK_PATTERN = /([A-Za-zÀ-ɏ])-\n([A-Za-zÀ-ɏ])/g;

export function cleanPdfTabArtifacts(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (POV_CHAPTER_PATTERN.test(trimmed) || SPECIAL_CHAPTER_PATTERN.test(trimmed)) {
        return line;
      }
      return line.replace(/\t/g, ' ');
    })
    .join('\n');
}

export function cleanPdfProse(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (POV_CHAPTER_PATTERN.test(trimmed) || SPECIAL_CHAPTER_PATTERN.test(trimmed)) {
        return line;
      }
      if (/^(?:https?:\/\/|www\.)\S+/i.test(trimmed)) return '';
      if (/^p[áa]g(?:ina|\.)?\s*\d+$/i.test(trimmed)) return '';
      if (/^\d{1,4}$/.test(trimmed)) return '';
      return line;
    })
    .join('\n')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/\.\s+\.\s+\./g, '…');
}

export function normalizeExtractedText(value) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(HYPHENATED_LINE_BREAK_PATTERN, '$1$2')
    .replace(/\u0000/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Pipeline completo, en el mismo orden que el cliente. */
export function cleanFullText(raw) {
  return normalizeExtractedText(cleanPdfProse(cleanPdfTabArtifacts(raw)));
}
