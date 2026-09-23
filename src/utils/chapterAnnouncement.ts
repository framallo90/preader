/**
 * Qué se anuncia en voz alta al arrancar un capítulo, y cuándo.
 *
 * Acá va sólo la DECISIÓN, sin motor de voz ni reproductor: así se puede
 * probar sin nativos. Quien lo dice en voz alta es `chapterAnnouncer`.
 */

/** Tan cerca del principio del capítulo que se considera "arrancar ahí". */
const NEAR_START_CHARS = 400;
export type AnnounceableChapter = { title: string; orderIndex: number; startChar: number };

/** El texto que se dice. Separado para poder probarlo sin motor de voz. */
export function buildAnnouncement(chapter: AnnounceableChapter): string {
  const titulo = chapter.title.trim();
  const numero = chapter.orderIndex + 1;
  // Si el título YA dice "capítulo", no se repite ("Capítulo 3. Capítulo 3").
  if (/^cap[ií]tulo\b/i.test(titulo)) return `${titulo}.`;
  if (titulo.length === 0) return `Capítulo ${numero}.`;
  return `Capítulo ${numero}. ${titulo}.`;
}

/**
 * ¿Corresponde anunciar al arrancar en `atChar`?
 *
 * `forced` es para cuando saltaste a un capítulo a propósito: ahí se anuncia
 * aunque el salto caiga unos caracteres adentro.
 */
export function chapterToAnnounce(
  chapters: AnnounceableChapter[] | undefined,
  atChar: number,
  forced: boolean,
): AnnounceableChapter | null {
  if (!chapters?.length) return null;
  let actual: AnnounceableChapter | null = null;
  for (const chapter of chapters) {
    if (chapter.startChar <= atChar) actual = chapter;
    else break;
  }
  if (!actual) return null;
  if (forced) return actual;
  return atChar - actual.startChar <= NEAR_START_CHARS ? actual : null;
}
