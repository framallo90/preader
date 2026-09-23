/**
 * "¿Quién era este?": los personajes de un libro, sin IA y sin spoilers.
 *
 * Sin IA: un nombre propio es una palabra con mayúscula que aparece seguido y
 * NO por estar al principio de una oración ("Entonces" tiene mayúscula por
 * estar primera; "Arya" la tiene siempre). Se cuentan sólo las apariciones en
 * medio de una oración.
 *
 * Sin spoilers: todo se calcula únicamente sobre el texto que YA leíste. Así
 * nunca aparece un personaje que todavía no entró, ni una mención de más
 * adelante. De paso, es menos texto que recorrer.
 */

/** Palabras que van con mayúscula por otra razón (tratamientos, meses, días). */
const NOT_NAMES = new Set([
  'señor', 'señora', 'señorita', 'don', 'doña', 'sir', 'lady', 'lord', 'mister', 'miss', 'mrs', 'mr',
  'dios', 'capítulo', 'capitulo', 'parte', 'libro', 'prólogo', 'prologo', 'epílogo', 'epilogo',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  'the', 'and', 'but', 'she', 'his', 'her', 'they', 'then', 'what', 'when', 'where',
]);

/** Una aparición por nombre cuenta como personaje recién desde este número. */
export const MIN_MENTIONS = 3;

/** Qué parte de las apariciones tiene que estar en medio de una oración. */
const MIN_MID_SHARE = 0.25;

export type CharacterCandidate = { name: string; count: number; firstChar: number };

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * ¿Esta posición es el comienzo de una oración? Se mira hacia atrás saltando
 * espacios, comillas y rayas de diálogo, hasta el primer signo con peso.
 */
function startsSentence(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '"' || ch === '«' || ch === '“' || ch === '—' || ch === '-' || ch === '¿' || ch === '¡' || ch === '(') continue;
    return ch === '.' || ch === '!' || ch === '?' || ch === '…' || ch === '\n' || ch === ':';
  }
  return true;
}

/**
 * Los nombres que más aparecen hasta `untilChar`, de mayor a menor.
 *
 * Recorre el texto una sola vez con índices (sin copiarlo ni pasarlo a
 * minúsculas entero: en Hermes cada copia de un libro de 2 MB se nota).
 */
export function findCharacterCandidates(text: string, untilChar: number, limit = 30): CharacterCandidate[] {
  const fin = Math.min(Math.max(untilChar, 0), text.length);
  // Por palabra con mayúscula: cuántas veces, cuántas en MEDIO de una oración
  // (la prueba de que es nombre propio) y dónde apareció primero.
  const mayus = new Map<string, { count: number; mid: number; firstChar: number }>();
  // Por palabra en minúscula: para descartar las comunes ("Entonces"/"entonces").
  const minus = new Map<string, number>();
  let i = 0;
  while (i < fin) {
    const ch = text[i];
    if (!isLetter(ch)) { i += 1; continue; }
    const inicio = i;
    while (i < fin && isLetter(text[i])) i += 1;
    if (i - inicio < 3) continue;
    const palabra = text.slice(inicio, i);
    if (!isUpper(ch)) {
      if (palabra === palabra.toLowerCase()) minus.set(palabra, (minus.get(palabra) ?? 0) + 1);
      continue;
    }
    // TODO EN MAYÚSCULAS es un título o un grito, no un nombre.
    if (palabra === palabra.toUpperCase()) continue;
    const previo = mayus.get(palabra);
    const enMedio = startsSentence(text, inicio) ? 0 : 1;
    if (previo) {
      previo.count += 1;
      previo.mid += enMedio;
    } else {
      mayus.set(palabra, { count: 1, mid: enMedio, firstChar: inicio });
    }
  }

  const salida: CharacterCandidate[] = [];
  for (const [name, datos] of mayus) {
    if (datos.mid === 0) continue; // sólo aparece encabezando oraciones: no hay prueba
    // Un nombre aparece seguido en medio de la oración; "Finalmente" casi nunca.
    if (datos.mid < datos.count * MIN_MID_SHARE) continue;
    if (datos.count < MIN_MENTIONS) continue;
    const comun = name.toLowerCase();
    if (NOT_NAMES.has(comun)) continue;
    // Si en minúscula aparece tanto como con mayúscula, es una palabra común.
    if ((minus.get(comun) ?? 0) >= datos.count) continue;
    salida.push({ name, count: datos.count, firstChar: datos.firstChar });
  }
  return salida
    .sort((a, b) => b.count - a.count || a.firstChar - b.firstChar)
    .slice(0, limit);
}

export type Mention = { start: number; end: number };

/**
 * Dónde aparece un nombre hasta `untilChar`, como palabra entera.
 *
 * Distingue mayúsculas a propósito: "Rosa" (el personaje) no es "rosa" (la flor).
 */
export function findMentions(text: string, name: string, untilChar: number, limit = 300): Mention[] {
  const fin = Math.min(Math.max(untilChar, 0), text.length);
  const salida: Mention[] = [];
  if (name.length === 0) return salida;
  let desde = 0;
  while (salida.length < limit) {
    const at = text.indexOf(name, desde);
    if (at < 0 || at >= fin) break;
    const antes = at > 0 ? text[at - 1] : ' ';
    const despues = at + name.length < text.length ? text[at + name.length] : ' ';
    if (!isLetter(antes) && !isLetter(despues)) salida.push({ start: at, end: at + name.length });
    desde = at + name.length;
  }
  return salida;
}

/** Un pedazo de texto alrededor de una mención, para mostrarla en la lista. */
export function mentionSnippet(text: string, mention: Mention, radius = 70): string {
  const desde = Math.max(0, mention.start - radius);
  const hasta = Math.min(text.length, mention.end + radius);
  const cuerpo = text.slice(desde, hasta).replace(/\s+/g, ' ').trim();
  return `${desde > 0 ? '…' : ''}${cuerpo}${hasta < text.length ? '…' : ''}`;
}
