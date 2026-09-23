import { Book } from '../types/storage';
import { compareBooksManually, compareBooksNaturally, getDisplayTitle } from './bookDisplay';
import { foldText } from './textSearch';
import { getSafFolderPath } from './safPaths';

/**
 * "Seguir con el siguiente": el libro que viene después en la misma saga.
 *
 * Una saga, en la práctica, es una carpeta: la gente guarda "Canción de hielo y
 * fuego" o "Absolute Batman" cada una en la suya. Así que no se pide armar
 * sagas a mano (nadie lo haría): el siguiente es el que sigue en la MISMA
 * carpeta, en el orden en que la ves.
 *
 * El orden: si acomodaste esa carpeta a mano, manda tu orden; si no, el título
 * en orden natural, que ya pone "2" antes que "10" y "#01" antes que "#02".
 */

type SeriesBook = Pick<Book, 'id' | 'uri' | 'title' | 'name' | 'orderIndex'>;

/** La carpeta donde está el archivo, o null si no vino de una carpeta (importado a mano). */
export function folderKey(uri: string): string | null {
  if (!uri.includes('/document/')) return null;
  const path = getSafFolderPath(uri);
  const corte = path.lastIndexOf('/');
  return corte <= 0 ? null : path.slice(0, corte);
}

/** Con menos letras en común que esto, dos títulos no se parecen como tomos. */
const MIN_SHARED_PREFIX = 4;

/** Sólo las letras y dígitos, sin tildes ni mayúsculas: "Absolute Batman #01" → "absolutebatman01". */
function compact(title: string): string {
  return foldText(title).replace(/[^a-z0-9]/g, '');
}

/**
 * ¿Estos dos libros parecen tomos de lo mismo?
 *
 * Una carpeta NO siempre es una saga: mucha gente tiene una carpeta "Libros"
 * con noventa títulos que no tienen nada que ver. Ofrecer "sigue en la saga"
 * entre dos de esos sería absurdo. Se pide una señal de que son tomos: que el
 * título arranque igual ("Absolute Batman #01" / "#02") o que los dos arranquen
 * con número ("1) Juego de tronos" / "2) Choque de reyes").
 */
export function looksLikeSameSeries(a: Pick<Book, 'title' | 'name'>, b: Pick<Book, 'title' | 'name'>): boolean {
  const ta = getDisplayTitle(a);
  const tb = getDisplayTitle(b);
  if (/^\s*\d/.test(ta) && /^\s*\d/.test(tb)) return true;
  const ca = compact(ta);
  const cb = compact(tb);
  let comun = 0;
  while (comun < ca.length && comun < cb.length && ca[comun] === cb[comun]) comun += 1;
  // Si lo compartido es sólo un número ("1984" y "1917"), no alcanza.
  return comun >= MIN_SHARED_PREFIX && /[a-z]/.test(ca.slice(0, comun));
}

export function nextInSeries<T extends SeriesBook>(current: T, books: T[]): T | null {
  const carpeta = folderKey(current.uri);
  if (!carpeta) return null;
  const hermanos = books.filter((book) => folderKey(book.uri) === carpeta);
  if (hermanos.length < 2) return null;

  const aMano = hermanos.some((book) => book.orderIndex > 0);
  const ordenados = [...hermanos].sort(aMano ? compareBooksManually : compareBooksNaturally);
  const posicion = ordenados.findIndex((book) => book.id === current.id);
  if (posicion < 0 || posicion === ordenados.length - 1) return null;
  const siguiente = ordenados[posicion + 1];
  // Acomodar la carpeta a mano ya dice "esto va en orden": no hace falta más.
  if (aMano) return siguiente;
  return looksLikeSameSeries(current, siguiente) ? siguiente : null;
}
