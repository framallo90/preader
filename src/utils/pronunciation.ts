/**
 * Diccionario de pronunciación: "Qhorin" → "Corin".
 *
 * Las voces del sistema leen mal los nombres inventados y uno escucha el mismo
 * error cientos de veces a lo largo de una saga. Esto cambia la palabra SÓLO en
 * lo que se le manda al motor de voz: el texto que se ve no se toca.
 *
 * Sobre la sincronía: la posición de la voz se calcula por proporción dentro de
 * cada tramo (tiempo / duración × largo). Cambiar "Qhorin" (6) por "Corin" (5)
 * corre esa cuenta a lo sumo un carácter por aparición, sólo dentro de ese
 * tramo, y se re-sincroniza en el siguiente. La cuenta ya era aproximada (la
 * voz no habla a velocidad pareja por letra), así que no hace falta un mapa de
 * posiciones exacto, que obligaría a tocar todo el camino de la voz.
 */

export type Pronunciation = { from: string; to: string };

/** Escapa lo que el motor de expresiones regulares interpretaría. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Quita entradas vacías, repetidas o que no cambian nada. */
export function cleanPronunciations(entries: Pronunciation[]): Pronunciation[] {
  const vistos = new Set<string>();
  const salida: Pronunciation[] = [];
  for (const entry of entries) {
    const from = entry.from.trim();
    const to = entry.to.trim();
    if (from.length === 0 || to.length === 0 || from.toLowerCase() === to.toLowerCase()) continue;
    const clave = from.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ from, to });
  }
  // Primero las más largas: "Jon Nieve" antes que "Jon", así la frase entera
  // gana sobre la palabra suelta.
  return salida.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Aplica el diccionario sobre el texto que va a la voz.
 *
 * Sólo palabras enteras: "Jon" no toca "Jonás". Sin distinguir mayúsculas,
 * porque el mismo nombre aparece en mayúsculas en los títulos.
 */
export function applyPronunciations(text: string, entries: Pronunciation[]): string {
  if (entries.length === 0 || text.length === 0) return text;
  let salida = text;
  for (const { from, to } of cleanPronunciations(entries)) {
    // Sin lookbehind a propósito: se captura el carácter previo y se repone.
    const patron = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(from)}(?=[^\\p{L}\\p{N}]|$)`, 'giu');
    salida = salida.replace(patron, (_match, previo: string) => `${previo}${to}`);
  }
  return salida;
}

/**
 * Firma corta de un texto, para la clave del caché de audio.
 *
 * El audio de cada tramo se guarda por rango de texto. Si cambiás una
 * pronunciación, el mismo rango tiene que sonar distinto: sin esta firma en la
 * clave, se seguiría reproduciendo el audio viejo con el nombre mal dicho.
 */
export function textSignature(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
