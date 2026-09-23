import { BookNote } from '../types/storage';

/**
 * Tus notas como Markdown, para llevarlas a Notion, Obsidian o un mail.
 *
 * Markdown y no PDF ni HTML porque es texto plano: se abre en cualquier lado,
 * se puede buscar, y dentro de diez años va a seguir abriéndose.
 */

type ExportableNote = Pick<BookNote, 'type' | 'page' | 'body' | 'comment' | 'charIndex'>;

const TYPE_LABEL: Record<string, string> = {
  bookmark: 'Marcador',
  quote: 'Cita',
  note: 'Nota',
};

/** Escapa lo que rompería el formato al pegarlo en otro lado. */
function asQuote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line.trim()}`)
    .join('\n');
}

/**
 * @param level Nivel del encabezado del libro. Exportando un libro solo es 1;
 *   dentro de "Mis notas" baja a 2, para que el archivo no quede con dos
 *   títulos de primer nivel (Notion y Obsidian muestran los dos como título).
 */
export function notesToMarkdown(
  bookTitle: string,
  notes: ExportableNote[],
  author?: string | null,
  level: 1 | 2 = 1,
): string {
  const hash = '#'.repeat(level);
  const subHash = '#'.repeat(level + 1);
  const partes: string[] = [`${hash} ${bookTitle}`];
  if (author && author.trim()) partes.push(`*${author.trim()}*`);
  if (notes.length === 0) {
    partes.push('', '_Sin marcadores, citas ni notas._');
    return `${partes.join('\n')}\n`;
  }

  // En orden de aparición en el libro, que es como se relee.
  const ordenadas = [...notes].sort((a, b) => a.charIndex - b.charIndex);
  for (const note of ordenadas) {
    const etiqueta = TYPE_LABEL[note.type] ?? 'Nota';
    const ubicacion = note.page !== null && note.page !== undefined ? ` · pág. ${note.page + 1}` : '';
    partes.push('', `${subHash} ${etiqueta}${ubicacion}`);
    const cuerpo = note.body?.trim();
    if (cuerpo) partes.push('', asQuote(cuerpo));
    const comentario = note.comment?.trim();
    if (comentario) partes.push('', comentario);
  }
  return `${partes.join('\n')}\n`;
}

/** Varias obras en un solo archivo, cada una con su encabezado. */
export function libraryNotesToMarkdown(
  books: { title: string; author?: string | null; notes: ExportableNote[] }[],
): string {
  const conNotas = books.filter((book) => book.notes.length > 0);
  if (conNotas.length === 0) return '# Mis notas\n\n_Todavía no hay nada guardado._\n';
  const cuerpo = conNotas
    .map((book) => notesToMarkdown(book.title, book.notes, book.author, 2))
    .join('\n\n---\n\n');
  return `# Mis notas\n\n${cuerpo}`;
}
