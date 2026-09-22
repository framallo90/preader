import { describe, it, expect } from 'vitest';

import { getWordRangeAt } from './wordRange';

describe('getWordRangeAt', () => {
  it('encuentra la palabra que contiene el índice', () => {
    expect(getWordRangeAt('Hola mundo', 1)).toEqual({ start: 0, end: 4 });
    expect(getWordRangeAt('Hola mundo', 6)).toEqual({ start: 5, end: 10 });
  });

  it('si el índice cae en un espacio, toma la palabra anterior', () => {
    expect(getWordRangeAt('Hola mundo', 4)).toEqual({ start: 0, end: 4 });
  });

  it('respeta acentos y ñ como parte de la palabra', () => {
    expect(getWordRangeAt('canción', 3)).toEqual({ start: 0, end: 7 });
  });

  it('devuelve null con texto vacío o sin palabra alrededor', () => {
    expect(getWordRangeAt('', 0)).toBeNull();
    expect(getWordRangeAt('   ', 1)).toBeNull();
  });
});

describe('palabras fuera del alfabeto latino básico', () => {
  it('no corta una palabra con letras del latín extendido', () => {
    const texto = 'Vivía en Kraków desde chico.';
    const inicio = texto.indexOf('Kraków');
    const rango = getWordRangeAt(texto, inicio);
    expect(texto.slice(rango!.start, rango!.end)).toBe('Kraków');
  });

  it('resalta también en cirílico y griego', () => {
    const ruso = 'Он читал книгу вечером.';
    const inicio = ruso.indexOf('книгу');
    const rango = getWordRangeAt(ruso, inicio);
    expect(ruso.slice(rango!.start, rango!.end)).toBe('книгу');
  });
});
