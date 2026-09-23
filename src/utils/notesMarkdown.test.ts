import { describe, expect, it } from 'vitest';

import { libraryNotesToMarkdown, notesToMarkdown } from './notesMarkdown';

const nota = (over: Partial<Parameters<typeof notesToMarkdown>[1][number]> = {}) => ({
  type: 'quote' as const,
  page: null,
  body: 'El viajero llegó al pueblo.',
  comment: null,
  charIndex: 100,
  ...over,
});

describe('notesToMarkdown', () => {
  it('pone el título como encabezado y el autor en itálica', () => {
    const md = notesToMarkdown('Juego de tronos', [nota()], 'George R. R. Martin');
    expect(md).toContain('# Juego de tronos');
    expect(md).toContain('*George R. R. Martin*');
  });

  it('la cita va como bloque de cita', () => {
    expect(notesToMarkdown('X', [nota()])).toContain('> El viajero llegó al pueblo.');
  });

  it('una cita de varios renglones queda toda citada', () => {
    const md = notesToMarkdown('X', [nota({ body: 'primer renglón\nsegundo renglón' })]);
    expect(md).toContain('> primer renglón');
    expect(md).toContain('> segundo renglón');
  });

  it('muestra la página en base 1, no en base 0', () => {
    expect(notesToMarkdown('X', [nota({ page: 7 })])).toContain('pág. 8');
  });

  it('sin página no inventa una', () => {
    expect(notesToMarkdown('X', [nota({ page: null })])).not.toContain('pág.');
  });

  it('ordena por aparición en el libro, no por cuándo la guardaste', () => {
    const md = notesToMarkdown('X', [
      nota({ charIndex: 900, body: 'la del final' }),
      nota({ charIndex: 10, body: 'la del principio' }),
    ]);
    expect(md.indexOf('la del principio')).toBeLessThan(md.indexOf('la del final'));
  });

  it('traduce los tres tipos', () => {
    expect(notesToMarkdown('X', [nota({ type: 'bookmark' })])).toContain('## Marcador');
    expect(notesToMarkdown('X', [nota({ type: 'note', comment: 'mi comentario' })])).toContain('## Nota');
  });

  it('el comentario aparece aparte de la cita', () => {
    const md = notesToMarkdown('X', [nota({ comment: 'esto me hizo acordar a algo' })]);
    expect(md).toContain('> El viajero llegó al pueblo.');
    expect(md).toContain('esto me hizo acordar a algo');
  });

  it('un libro sin notas lo dice, no devuelve vacío', () => {
    expect(notesToMarkdown('X', [])).toContain('Sin marcadores');
  });
});

describe('libraryNotesToMarkdown', () => {
  it('junta varios libros separados por una línea', () => {
    const md = libraryNotesToMarkdown([
      { title: 'Uno', notes: [nota({ body: 'de uno' })] },
      { title: 'Dos', notes: [nota({ body: 'de dos' })] },
    ]);
    expect(md).toContain('# Uno');
    expect(md).toContain('# Dos');
    expect(md).toContain('---');
  });

  it('saltea los libros sin notas', () => {
    const md = libraryNotesToMarkdown([
      { title: 'Vacío', notes: [] },
      { title: 'Con notas', notes: [nota()] },
    ]);
    expect(md).not.toContain('# Vacío');
    expect(md).toContain('# Con notas');
  });

  it('adentro de la biblioteca el libro baja a nivel 2, para no tener dos títulos', () => {
    const md = libraryNotesToMarkdown([{ title: 'Uno', notes: [nota()] }]);
    expect(md).toContain('# Mis notas');
    expect(md).toContain('## Uno');
    // El único encabezado de primer nivel tiene que ser el del archivo.
    expect(md.split('\n').filter((line) => /^# /.test(line))).toEqual(['# Mis notas']);
    expect(md).toContain('### Cita');
  });

  it('sin nada guardado lo dice en vez de devolver un archivo vacío', () => {
    expect(libraryNotesToMarkdown([])).toContain('Todavía no hay nada guardado');
  });
});
