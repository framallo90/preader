import { ChapterInfo } from '../types/document';

// Capítulo POV: "BRAN\t(1)", "CATELYN\t(2)", etc.
const POV_CHAPTER_PATTERN = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{1,30})\t\((\d+)\)$/;

// Capítulos especiales sin número
const SPECIAL_CHAPTER_PATTERN = /^(PRÓLOGO|EPÍLOGO|PREFACIO|PRESENTACIÓN|INTRODUCCIÓN)$/;

// Tabs que separan palabras (artefacto de conversión ePUB→PDF)
const TAB_WORD_SEPARATOR = /([^\n])\t([^\n(])/g;

/**
 * Limpia los artefactos de conversión ePUB→PDF:
 * - Reemplaza tabs entre palabras por espacios
 * - Mantiene tabs que forman parte del patrón de capítulo
 */
export function cleanPdfTabArtifacts(text: string): string {
  // Primero marcamos los tabs que son parte de encabezados de capítulo
  // para no borrarlos. Luego limpiamos el resto.
  const lines = text.split('\n');

  return lines
    .map((line) => {
      const trimmed = line.trim();

      // Si la línea es un encabezado de capítulo, la dejamos intacta
      if (POV_CHAPTER_PATTERN.test(trimmed) || SPECIAL_CHAPTER_PATTERN.test(trimmed)) {
        return line;
      }

      // En el resto del texto, reemplazamos tabs por espacios
      return line.replace(/\t/g, ' ');
    })
    .join('\n');
}

/**
 * Detecta capítulos en el texto extraído de un PDF de ASOIAF.
 * Retorna un array de ChapterInfo con posición, personaje POV y número.
 */
export function detectChapters(bookId: string, fullText: string): ChapterInfo[] {
  const lines = fullText.split('\n');
  const chapters: ChapterInfo[] = [];
  let charOffset = 0;
  let chapterOrderIndex = 0;

  // Primera pasada: encontrar posiciones de los encabezados de capítulo
  const chapterHeaders: Array<{
    title: string;
    povCharacter: string | null;
    povNumber: number | null;
    startChar: number;
  }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lineLength = line.length + 1; // +1 por el \n

    const povMatch = POV_CHAPTER_PATTERN.exec(trimmed);
    if (povMatch) {
      chapterHeaders.push({
        title: `${povMatch[1].trim()} (${povMatch[2]})`,
        povCharacter: povMatch[1].trim(),
        povNumber: parseInt(povMatch[2], 10),
        startChar: charOffset,
      });
      charOffset += lineLength;
      continue;
    }

    const specialMatch = SPECIAL_CHAPTER_PATTERN.exec(trimmed);
    if (specialMatch) {
      chapterHeaders.push({
        title: specialMatch[1],
        povCharacter: null,
        povNumber: null,
        startChar: charOffset,
      });
      charOffset += lineLength;
      continue;
    }

    charOffset += lineLength;
  }

  // Segunda pasada: construir ChapterInfo con startChar/endChar
  for (let i = 0; i < chapterHeaders.length; i++) {
    const header = chapterHeaders[i];
    const nextHeader = chapterHeaders[i + 1];

    const endChar = nextHeader ? nextHeader.startChar : fullText.length;

    chapters.push({
      id: `${bookId}--ch-${chapterOrderIndex}`,
      title: header.title,
      povCharacter: header.povCharacter,
      povNumber: header.povNumber,
      orderIndex: chapterOrderIndex,
      startChar: header.startChar,
      endChar,
    });

    chapterOrderIndex++;
  }

  return chapters;
}
