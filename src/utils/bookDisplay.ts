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
  return withoutFolder.replace(/\.(pdf|epub|txt|docx)$/i, '').trim() || withoutFolder;
}

/**
 * Orden natural ("2)" antes que "10)"), como espera cualquier humano con una
 * saga numerada.
 */
export function compareBooksNaturally(a: Pick<Book, 'title' | 'name'>, b: Pick<Book, 'title' | 'name'>): number {
  return getDisplayTitle(a).localeCompare(getDisplayTitle(b), 'es', { numeric: true, sensitivity: 'base' });
}
