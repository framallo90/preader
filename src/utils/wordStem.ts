/**
 * Raíz aproximada de una palabra en castellano, para que buscar "correr"
 * encuentre "corriendo" y "corrieron".
 *
 * No es un stemmer de verdad (eso es una dependencia grande y un montón de
 * reglas): es una lista de terminaciones frecuentes, ordenada de la más larga a
 * la más corta, con dos frenos para no pasarse:
 *
 *  - La raíz nunca queda con menos de `MIN_STEM` letras.
 *  - Si no se saca ninguna terminación, la palabra queda igual, y quien busca
 *    sigue haciendo la búsqueda exacta de siempre. Así esto solo puede AGREGAR
 *    resultados donde antes no había, nunca cambiar los que ya andaban.
 */

/** Menos que esto y la raíz encuentra cualquier cosa. */
const MIN_STEM = 4;

// Se ordenan por largo al cargar el módulo, así la regla "gana la más larga"
// vale siempre, sin depender de cómo estén escritas acá abajo.
const SUFFIXES = [
  // Verbos: condicional, futuro, imperfecto, pretérito.
  'aríamos', 'eríamos', 'iríamos',
  'aremos', 'eremos', 'iremos',
  'ábamos', 'íamos',
  'asteis', 'isteis',
  'aríais', 'eríais', 'iríais',
  'aría', 'ería', 'iría', 'arías', 'erías', 'irías',
  'aron', 'ieron', 'aban', 'ían',
  'ando', 'iendo', 'yendo',
  'ados', 'idos', 'adas', 'idas',
  'aste', 'iste', 'abas', 'ías',
  'amos', 'emos', 'imos',
  'ado', 'ido', 'ada', 'ida',
  'aba', 'ía',
  'an', 'en', 'as', 'es', 'os',
  'ar', 'er', 'ir',
  // Sustantivos y adjetivos.
  'ciones', 'ción', 'mente', 'idades', 'idad',
  'a', 'o', 's',
].sort((a, b) => b.length - a.length);

/**
 * Raíz de la palabra, o la palabra tal cual si no se le reconoce terminación.
 * Se espera que llegue ya plegada (sin tildes ni mayúsculas).
 */
export function wordStem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= MIN_STEM && word.endsWith(suffix)) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/** true si vale la pena buscar por raíz (la raíz dice algo distinto). */
export function hasUsefulStem(word: string): boolean {
  const stem = wordStem(word);
  return stem.length >= MIN_STEM && stem !== word;
}
