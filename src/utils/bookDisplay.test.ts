import { describe, expect, it } from 'vitest';

import {
  ORDER_STEP,
  buildOrderEntries,
  cleanFileName,
  compareBooksManually,
  compareBooksNaturally,
  getDisplayTitle,
} from './bookDisplay';

const libro = (name: string, orderIndex = 0, title: string | null = null) => ({ id: name, name, title, orderIndex });

describe('getDisplayTitle', () => {
  it('prefiere el título real sobre el nombre del archivo', () => {
    expect(getDisplayTitle({ title: 'Juego de tronos', name: 'got1.pdf' })).toBe('Juego de tronos');
  });

  it('con título vacío cae al nombre del archivo', () => {
    expect(getDisplayTitle({ title: '   ', name: 'got1.pdf' })).toBe('got1');
  });
});

describe('cleanFileName', () => {
  it('saca la extensión', () => {
    expect(cleanFileName('Tormenta de espadas.epub')).toBe('Tormenta de espadas');
  });

  it('saca el prefijo de carpeta', () => {
    expect(cleanFileName('Game of saga/3) Tormenta.pdf')).toBe('3) Tormenta');
  });

  it('un nombre sin extensión queda igual', () => {
    expect(cleanFileName('LEEME')).toBe('LEEME');
  });
});

describe('compareBooksNaturally', () => {
  it('ordena 2 antes que 10, no alfabéticamente', () => {
    const ordenados = [libro('10) Diez.pdf'), libro('2) Dos.pdf')].sort(compareBooksNaturally);
    expect(ordenados.map((b) => b.name)).toEqual(['2) Dos.pdf', '10) Diez.pdf']);
  });
});

describe('compareBooksManually', () => {
  it('respeta el orden guardado', () => {
    const ordenados = [libro('c', 3000), libro('a', 1000), libro('b', 2000)].sort(compareBooksManually);
    expect(ordenados.map((b) => b.name)).toEqual(['a', 'b', 'c']);
  });

  it('los libros sin ordenar van AL FINAL, no al principio', () => {
    // Es lo que evita que un libro recién escaneado se cuele arriba de tu orden.
    const ordenados = [libro('nuevo'), libro('primero', 1000)].sort(compareBooksManually);
    expect(ordenados.map((b) => b.name)).toEqual(['primero', 'nuevo']);
  });

  it('entre los que no tienen orden, manda el título natural', () => {
    const ordenados = [libro('10) diez'), libro('2) dos')].sort(compareBooksManually);
    expect(ordenados.map((b) => b.name)).toEqual(['2) dos', '10) diez']);
  });

  it('varios nuevos no se pisan entre ellos ni tapan a los ordenados', () => {
    const ordenados = [libro('zeta'), libro('alfa'), libro('puesto', 5000)].sort(compareBooksManually);
    expect(ordenados.map((b) => b.name)).toEqual(['puesto', 'alfa', 'zeta']);
  });
});

describe('buildOrderEntries', () => {
  it('numera espaciado desde 1, nunca 0', () => {
    expect(buildOrderEntries([{ id: 'a' }, { id: 'b' }])).toEqual([
      { id: 'a', orderIndex: ORDER_STEP },
      { id: 'b', orderIndex: ORDER_STEP * 2 },
    ]);
  });

  it('una carpeta vacía no genera nada', () => {
    expect(buildOrderEntries([])).toEqual([]);
  });

  it('lo que genera, ordenado, devuelve el mismo orden', () => {
    const entradas = buildOrderEntries([{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
    const libros = entradas.map((e) => libro(e.id, e.orderIndex));
    expect([...libros].reverse().sort(compareBooksManually).map((b) => b.name)).toEqual(['x', 'y', 'z']);
  });
});
