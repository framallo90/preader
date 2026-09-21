/**
 * Prepara el texto que se le manda al motor de voz.
 *
 * El texto de un PDF viene con las líneas cortadas donde terminaba el renglón
 * impreso, en medio de la oración. Los motores TTS suelen leer un salto de línea
 * como una pausa, así que la narración sonaría entrecortada renglón por renglón.
 *
 * Se reemplaza el salto por un espacio SOLO cuando es un corte de renglón. Se
 * conserva cuando marca estructura de verdad: línea en blanco (párrafo), línea
 * que cierra una oración, o línea corta sin puntuación (título, verso, ítem).
 *
 * El reemplazo es 1 a 1: el resultado mide EXACTAMENTE lo mismo que la entrada,
 * porque la posición de la voz se calcula por proporción sobre el largo del tramo.
 */
const MIN_WRAPPED_LINE_LENGTH = 40;
const ENDS_SENTENCE = /[.!?…:]["'»”’)\]]*$/;

export function prepareSpeechText(text: string): string {
  const lines = text.split('\n');
  let result = '';

  for (let i = 0; i < lines.length; i++) {
    result += lines[i];
    if (i === lines.length - 1) break;

    const line = lines[i].trim();
    const nextLine = lines[i + 1].trim();
    const keepBreak =
      line.length === 0 ||
      nextLine.length === 0 ||
      ENDS_SENTENCE.test(line) ||
      line.length < MIN_WRAPPED_LINE_LENGTH;

    result += keepBreak ? '\n' : ' ';
  }

  return result;
}
