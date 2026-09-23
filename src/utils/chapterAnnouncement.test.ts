import { describe, expect, it } from 'vitest';

import { AnnounceableChapter, buildAnnouncement, chapterToAnnounce } from './chapterAnnouncement';

const cap = (orderIndex: number, startChar: number, title: string): AnnounceableChapter => ({
  orderIndex,
  startChar,
  title,
});

const LIBRO: AnnounceableChapter[] = [
  cap(0, 0, 'Prólogo'),
  cap(1, 1000, 'La llegada'),
  cap(2, 5000, 'El cuaderno'),
];

describe('buildAnnouncement', () => {
  it('dice el número y el título', () => {
    expect(buildAnnouncement(cap(1, 0, 'La llegada'))).toBe('Capítulo 2. La llegada.');
  });

  it('no repite "capítulo" si el título ya lo dice', () => {
    expect(buildAnnouncement(cap(2, 0, 'Capítulo III'))).toBe('Capítulo III.');
    expect(buildAnnouncement(cap(2, 0, 'capitulo tres'))).toBe('capitulo tres.');
  });

  it('sin título dice solamente el número', () => {
    expect(buildAnnouncement(cap(4, 0, '   '))).toBe('Capítulo 5.');
  });
});

describe('chapterToAnnounce', () => {
  it('anuncia si arrancás justo donde empieza el capítulo', () => {
    expect(chapterToAnnounce(LIBRO, 1000, false)?.title).toBe('La llegada');
  });

  it('anuncia si arrancás pocos caracteres adentro', () => {
    expect(chapterToAnnounce(LIBRO, 1300, false)?.title).toBe('La llegada');
  });

  it('NO anuncia si retomás a mitad de capítulo', () => {
    // Es lo que evita que te diga "Capítulo 2" cada vez que le das play.
    expect(chapterToAnnounce(LIBRO, 3000, false)).toBeNull();
  });

  it('a mitad de capítulo SÍ anuncia si saltaste a propósito', () => {
    expect(chapterToAnnounce(LIBRO, 3000, true)?.title).toBe('La llegada');
  });

  it('antes del primer capítulo no anuncia nada', () => {
    expect(chapterToAnnounce([cap(0, 500, 'Uno')], 10, false)).toBeNull();
  });

  it('un libro sin capítulos no anuncia', () => {
    expect(chapterToAnnounce(undefined, 100, true)).toBeNull();
    expect(chapterToAnnounce([], 100, true)).toBeNull();
  });

  it('elige el capítulo correcto, no el primero que encuentra', () => {
    expect(chapterToAnnounce(LIBRO, 5050, false)?.title).toBe('El cuaderno');
  });
});
