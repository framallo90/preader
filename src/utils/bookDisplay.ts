import { Book } from '../types/storage';

/**
 * Título presentable de un libro: usa el título real (metadata) si existe;
 * si no, limpia el nombre de archivo (saca el prefijo de carpeta que traen
 * los libros escaneados — "Game of saga/3) Tormenta..." — y la extensión).
 */
export function getDisplayTitle(book: Pick<Book, 'title' | 'name'>): string {
  if (book.title && book.title.trim()) return book.title.trim();
  return cleanFileName(book.name);
}

export function cleanFileName(name: string): string {
  const withoutFolder = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return withoutFolder.replace(/\.(pdf|epub|txt|docx|cbz|cbr|cb7|cbt|zip|rar|7z|tar)$/i, '').trim() || withoutFolder;
}

/**
 * Orden natural ("2)" antes que "10)"), como espera cualquier humano con una
 * saga numerada.
 */
export function compareBooksNaturally(a: Pick<Book, 'title' | 'name'>, b: Pick<Book, 'title' | 'name'>): number {
  return getDisplayTitle(a).localeCompare(getDisplayTitle(b), 'es', { numeric: true, sensitivity: 'base' });
}

/** Separación entre posiciones guardadas: mover uno no reescribe la carpeta entera. */
export const ORDER_STEP = 1000;

/** El orden a mano de una carpeta, en índices espaciados listos para guardar. */
export function buildOrderEntries(books: Pick<Book, 'id'>[]): { id: string; orderIndex: number }[] {
  return books.map((book, index) => ({ id: book.id, orderIndex: (index + 1) * ORDER_STEP }));
}

type Ordenable = Pick<Book, 'title' | 'name' | 'orderIndex'>;

/**
 * Tu orden a mano dentro de una carpeta.
 *
 * `orderIndex` 0 significa "nunca lo ordenaste": esos van **al final**, no al
 * principio. Es lo que hace que un libro que aparece en un escaneo nuevo se
 * sume abajo en vez de colarse arriba del orden que armaste. Entre los que no
 * tienen orden, se acomodan por título, que es mejor que al azar.
 */
export function compareBooksManually(a: Ordenable, b: Ordenable): number {
  const ka = a.orderIndex > 0 ? a.orderIndex : Number.MAX_SAFE_INTEGER;
  const kb = b.orderIndex > 0 ? b.orderIndex : Number.MAX_SAFE_INTEGER;
  if (ka !== kb) return ka - kb;
  return compareBooksNaturally(a, b);
}
