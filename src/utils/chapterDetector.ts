import { ChapterInfo } from '../types/document';

// Capítulo POV: "BRAN\t(1)", "CATELYN\t(2)", etc.
const POV_CHAPTER_PATTERN = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{1,30})\t\((\d+)\)$/;

// Capítulos especiales sin número
const SPECIAL_CHAPTER_PATTERN = /^(PRÓLOGO|EPÍLOGO|PREFACIO|PRESENTACIÓN|INTRODUCCIÓN|PROLOGUE|EPILOGUE|PREFACE|INTRODUCTION)$/i;

// Encabezado genérico: "Capítulo 8", "CAPÍTULO XII. Del buen suceso", "Chapter 3",
// "Parte II", "Libro primero". Solo si la línea es corta (un título, no prosa).
//
// Lo que sigue a la palabra tiene que ser un NÚMERO: cifras, romanos o un
// ordinal/cardinal escrito. Antes se aceptaba "cualquier palabra en minúscula"
// y eso metía prosa en el índice: "Parte superior del cuerpo…", "Canto rodado
// sobre la ladera…" o "Section headers were common…" entraban como capítulos,
// porque en un PDF los renglones vienen cortados a ~70 caracteres y queda una
// línea en blanco antes de cada párrafo.
const NUMBER_WORD = [
  'primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|s[eé]ptim[oa]|octav[oa]|noven[oa]',
  'd[eé]cim[oa]|und[eé]cim[oa]|duod[eé]cim[oa]|[uú]ltim[oa]|final',
  'uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta',
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last',
  'one|two|three|four|five|six|seven|eight|nine|ten',
].join('|');
// Romanos acotados a I-XXXIX: con l/c/d/m entraban palabras corrientes
// ("mi", "dic", "mil") como si fueran números de capítulo.
const GENERIC_CHAPTER_PATTERN = new RegExp(
  '^(?:cap[ií]tulo|chapter|parte|part|libro|book|secci[oó]n|section|canto)' +
    String.raw`\s+(?:\d{1,4}|[ivx]{1,7}|(?:` +
    NUMBER_WORD +
    String.raw`))\b[.:\s-]*(.{0,70})$`,
  'i',
);
const MAX_HEADING_LENGTH = 90;

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
 * Limpieza local (instantánea, sin LLM) de artefactos típicos de PDFs de libros,
 * para que el TTS no lea basura y el texto en pantalla se vea bien. Reemplaza lo
 * que antes hacía el preprocesado con Llama, sin su latencia. Es conservador:
 * borra pies/números de página sueltos y arregla espacios de puntuación; no toca
 * el contenido de las oraciones.
 */
export function cleanPdfProse(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // No tocar encabezados de capítulo.
      if (POV_CHAPTER_PATTERN.test(trimmed) || SPECIAL_CHAPTER_PATTERN.test(trimmed)) {
        return line;
      }
      // Líneas que son sólo un pie de conversión (URL de sitio de descarga).
      if (/^(?:https?:\/\/|www\.)\S+/i.test(trimmed)) return '';
      // "Página 42", "Pág. 7" en su propia línea.
      if (/^p[áa]g(?:ina|\.)?\s*\d+$/i.test(trimmed)) return '';
      // Número de página suelto (una línea que es SÓLO dígitos). Decisión
      // consciente para el contenido objetivo (novelas/sagas): una línea que es
      // sólo 1-4 dígitos es casi siempre un número de página, no prosa. En
      // poesía/no-ficción esto podría borrar un verso/año suelto; si se
      // soportan esos géneros, condicionar a que las líneas vecinas estén vacías
      // (probado: eso perdía page numbers adyacentes a otro pie, ver test).
      if (/^\d{1,4}$/.test(trimmed)) return '';
      return line;
    })
    .join('\n')
    // Espacio sobrante antes de signos de puntuación (artefacto de extracción).
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    // Puntos suspensivos separados por espacios → uno solo.
    .replace(/\.\s+\.\s+\./g, '…');
}

/**
 * Detecta capítulos en el texto cuando el libro no trae índice propio: encabezados
 * genéricos ("Capítulo 8", "Parte II", "PRÓLOGO") y los de tipo POV ("BRAN (1)").
 */
export function detectChapters(bookId: string, fullText: string): ChapterInfo[] {
  const lines = fullText.split('\n');
  const chapters: ChapterInfo[] = [];
  let charOffset = 0;
  let chapterOrderIndex = 0;

  // Primera pasada: encontrar posiciones de los encabezados de capítulo
  const chapterHeaders: { title: string; startChar: number }[] = [];

  let previousBlank = true;
  for (const line of lines) {
    const trimmed = line.trim();
    const lineLength = line.length + 1; // +1 por el \n

    const povMatch = POV_CHAPTER_PATTERN.exec(trimmed);
    if (povMatch) {
      chapterHeaders.push({
        title: `${povMatch[1].trim()} (${povMatch[2]})`,
        startChar: charOffset,
      });
      charOffset += lineLength;
      // También acá: sin esto, el "hubo una línea en blanco antes" del
      // encabezado POV se filtraba a la PRIMERA LÍNEA DE LA PROSA que le
      // sigue, y esa línea entraba al índice como un capítulo fantasma que
      // partía en dos el capítulo real.
      previousBlank = false;
      continue;
    }

    const specialMatch = SPECIAL_CHAPTER_PATTERN.exec(trimmed);
    if (specialMatch) {
      chapterHeaders.push({
        title: specialMatch[1],
        startChar: charOffset,
      });
      charOffset += lineLength;
      previousBlank = false;
      continue;
    }

    // Un encabezado genérico tiene que estar SOLO en su renglón (línea corta y
    // precedida por una en blanco): "capítulo 3" en medio de un párrafo no cuenta.
    if (trimmed.length <= MAX_HEADING_LENGTH && previousBlank && GENERIC_CHAPTER_PATTERN.test(trimmed)) {
      chapterHeaders.push({ title: trimmed, startChar: charOffset });
      charOffset += lineLength;
      previousBlank = false;
      continue;
    }
    previousBlank = trimmed.length === 0;

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
      orderIndex: chapterOrderIndex,
      startChar: header.startChar,
      endChar,
    });

    chapterOrderIndex++;
  }

  return chapters;
}
