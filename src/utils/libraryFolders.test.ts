import { describe, expect, it } from 'vitest';

import { compareSubfolders, formatSubfolderLabel, getSubfolderPath } from './libraryFolders';

const RAIZ = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FLibros';
const doc = (ruta: string) => `${RAIZ}/document/${encodeURIComponent(`primary:Download/Libros/${ruta}`)}`;

describe('getSubfolderPath', () => {
  it('un archivo suelto en la raíz no tiene subcarpeta', () => {
    expect(getSubfolderPath(doc('libro.pdf'), RAIZ)).toBe('');
  });

  it('saca la subcarpeta de un archivo anidado', () => {
    expect(getSubfolderPath(doc('Saga X/libro-01.pdf'), RAIZ)).toBe('Saga X');
  });

  it('aguanta varios niveles', () => {
    expect(getSubfolderPath(doc('Comics/Marvel/2024/n1.cbz'), RAIZ)).toBe('Comics/Marvel/2024');
  });

  it('decodifica los espacios y los acentos de la URI', () => {
    expect(getSubfolderPath(doc('Ciencia ficción/Año 2000/x.epub'), RAIZ)).toBe('Ciencia ficción/Año 2000');
  });

  it('devuelve vacío si el libro no cuelga de esa raíz', () => {
    const otra = 'content://com.android.externalstorage.documents/tree/primary%3ADocumentos';
    expect(getSubfolderPath(doc('Saga X/libro.pdf'), otra)).toBe('');
  });

  it('no confunde una raíz que es prefijo de otra', () => {
    // "Libros2" empieza con "Libros" pero es otra carpeta distinta.
    const vecina = `${RAIZ}/document/${encodeURIComponent('primary:Download/Libros2/x.pdf')}`;
    expect(getSubfolderPath(vecina, RAIZ)).toBe('');
  });

  it('no se cae con una URI que importaste a mano (sin /document/)', () => {
    expect(getSubfolderPath('file:///data/user/0/app/files/x.pdf', RAIZ)).toBe('');
  });

  it('no se cae con datos vacíos', () => {
    expect(getSubfolderPath('', RAIZ)).toBe('');
    expect(getSubfolderPath(doc('a/b.pdf'), '')).toBe('');
  });
});

describe('formatSubfolderLabel', () => {
  it('un solo nivel va tal cual', () => {
    expect(formatSubfolderLabel('Saga X')).toBe('Saga X');
  });

  it('dos niveles se muestran enteros', () => {
    expect(formatSubfolderLabel('Comics/Marvel')).toBe('Comics / Marvel');
  });

  it('más hondo se recortan los de arriba', () => {
    expect(formatSubfolderLabel('Comics/Marvel/2024')).toBe('… / Marvel / 2024');
  });

  it('la raíz no tiene etiqueta', () => {
    expect(formatSubfolderLabel('')).toBe('');
  });
});

describe('compareSubfolders', () => {
  it('la raíz va siempre primero', () => {
    expect(['Saga X', '', 'Ab'].sort(compareSubfolders)).toEqual(['', 'Ab', 'Saga X']);
  });

  it('ordena natural: 2 antes que 10', () => {
    expect(['Tomo 10', 'Tomo 2'].sort(compareSubfolders)).toEqual(['Tomo 2', 'Tomo 10']);
  });

  it('no distingue tildes ni mayúsculas', () => {
    expect(compareSubfolders('árbol', 'Arbol')).toBe(0);
  });
});
