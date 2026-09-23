import { describe, expect, it } from 'vitest';

import { folderKey, looksLikeSameSeries, nextInSeries } from './series';

const RAIZ = 'content://com.android.externalstorage.documents/tree/primary%3AComics';
const en = (ruta: string) => `${RAIZ}/document/${encodeURIComponent(`primary:Comics/${ruta}`)}`;
const libro = (id: string, ruta: string, orderIndex = 0, title: string | null = null) => ({
  id,
  uri: en(ruta),
  name: ruta.split('/').pop() ?? ruta,
  title,
  orderIndex,
});

describe('folderKey', () => {
  it('devuelve la carpeta del archivo', () => {
    expect(folderKey(en('Absolute Batman/n01.cbr'))).toBe('primary:Comics/Absolute Batman');
  });

  it('un libro importado a mano no tiene carpeta', () => {
    expect(folderKey('file:///data/user/0/app/files/x.pdf')).toBeNull();
  });
});

describe('nextInSeries', () => {
  const saga = [
    libro('b10', 'Absolute Batman/Absolute Batman #10.cbr'),
    libro('b02', 'Absolute Batman/Absolute Batman #02.cbr'),
    libro('b01', 'Absolute Batman/Absolute Batman #01.cbr'),
    libro('otro', 'Marvel/Spider-Man #01.cbr'),
  ];

  it('el siguiente es el que sigue en orden natural', () => {
    expect(nextInSeries(saga[2], saga)?.id).toBe('b02');
    expect(nextInSeries(saga[1], saga)?.id).toBe('b10');
  });

  it('el último de la saga no tiene siguiente', () => {
    expect(nextInSeries(saga[0], saga)).toBeNull();
  });

  it('nunca salta a otra carpeta', () => {
    expect(nextInSeries(saga[3], saga)).toBeNull();
  });

  it('si acomodaste la carpeta a mano, manda tu orden', () => {
    const aMano = [
      libro('a', 'S/a.pdf', 2000),
      libro('b', 'S/b.pdf', 1000),
      libro('c', 'S/c.pdf', 3000),
    ];
    expect(nextInSeries(aMano[1], aMano)?.id).toBe('a');
    expect(nextInSeries(aMano[0], aMano)?.id).toBe('c');
  });

  it('usa el título real si lo tiene, no el nombre de archivo', () => {
    const conTitulo = [
      libro('x', 'Saga/zzz.epub', 0, '1. Juego de tronos'),
      libro('y', 'Saga/aaa.epub', 0, '2. Choque de reyes'),
    ];
    expect(nextInSeries(conTitulo[0], conTitulo)?.id).toBe('y');
  });

  it('un libro solo en su carpeta no tiene siguiente', () => {
    const solo = [libro('s', 'Suelto/uno.pdf')];
    expect(nextInSeries(solo[0], solo)).toBeNull();
  });

  it('un libro importado a mano no tiene saga', () => {
    const manual = { id: 'm', uri: 'file:///x.pdf', name: 'x.pdf', title: null, orderIndex: 0 };
    expect(nextInSeries(manual, [manual, ...saga])).toBeNull();
  });
});

describe('looksLikeSameSeries', () => {
  const t = (title: string) => ({ title, name: `${title}.pdf` });

  it('dos tomos numerados de un cómic', () => {
    expect(looksLikeSameSeries(t('Absolute Batman #01'), t('Absolute Batman #02'))).toBe(true);
  });

  it('dos tomos que arrancan con número', () => {
    expect(looksLikeSameSeries(t('1) Juego de tronos'), t('2) Choque de reyes'))).toBe(true);
  });

  it('dos libros que no tienen nada que ver', () => {
    expect(looksLikeSameSeries(t('Don Quijote'), t('Rayuela'))).toBe(false);
  });

  it('dos títulos que arrancan con número se aceptan: es el costo de soportar "1) …"', () => {
    expect(looksLikeSameSeries(t('1984'), t('1917 relatos'))).toBe(true);
  });

  it('no distingue tildes ni mayúsculas', () => {
    expect(looksLikeSameSeries(t('Canción de hielo 1'), t('CANCION DE HIELO 2'))).toBe(true);
  });
});

describe('nextInSeries en una carpeta general', () => {
  const general = [
    libro('q', 'Libros/Don Quijote.epub'),
    libro('r', 'Libros/Rayuela.epub'),
  ];

  it('no ofrece "sigue en la saga" entre libros que no tienen nada que ver', () => {
    expect(nextInSeries(general[0], general)).toBeNull();
  });

  it('pero si acomodaste la carpeta a mano, sí', () => {
    const aMano = [libro('q', 'Libros/Don Quijote.epub', 1000), libro('r', 'Libros/Rayuela.epub', 2000)];
    expect(nextInSeries(aMano[0], aMano)?.id).toBe('r');
  });
});
