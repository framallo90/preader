import { describe, expect, it } from 'vitest';

import { findQuoteIndex } from './pageQuote';

describe('findQuoteIndex', () => {
  it('encuentra una cita que en el PDF venía cortada en dos renglones', () => {
    const libro = 'Antes de todo. El viajero llegó al pueblo cuando caía la tarde. Después nada.';
    const cita = 'El viajero llegó al\npueblo cuando caía la tarde.';
    expect(findQuoteIndex(libro, cita, 0, libro.length)).toBe(libro.indexOf('El viajero'));
  });

  it('busca sólo dentro del tramo pedido', () => {
    const libro = 'una frase repetida aquí. relleno. una frase repetida aquí.';
    const segunda = libro.lastIndexOf('una frase repetida');
    expect(findQuoteIndex(libro, 'una frase repetida aquí.', segunda - 5, libro.length)).toBe(segunda);
  });

  it('se conforma con el arranque cuando el final no coincide', () => {
    const libro = 'El aire olía a pan recién hecho y a tierra mojada, porque había llovido.';
    const cita = 'El aire olía a pan recién hecho y a tierra mojada, PERO ESTO NO ESTÁ';
    expect(findQuoteIndex(libro, cita, 0, libro.length)).toBe(0);
  });

  it('devuelve null si la cita no está', () => {
    const libro = 'El viajero llegó al pueblo cuando caía la tarde.';
    expect(findQuoteIndex(libro, 'esto no aparece en ningún lado', 0, libro.length)).toBeNull();
  });

  it('no busca citas demasiado cortas: darían cualquier cosa', () => {
    const libro = 'de la casa de la esquina';
    expect(findQuoteIndex(libro, 'de la', 0, libro.length)).toBeNull();
  });

  it('aguanta espacios distintos de los dos lados', () => {
    const libro = 'primero  segundo   tercero cuarto quinto';
    expect(findQuoteIndex(libro, 'segundo tercero cuarto', 0, libro.length)).toBe(libro.indexOf('segundo'));
  });

  it('no se cae con un tramo vacío o dado vuelta', () => {
    const libro = 'lo que sea que diga esta frase';
    expect(findQuoteIndex(libro, 'lo que sea que diga', 10, 5)).toBeNull();
    expect(findQuoteIndex('', 'lo que sea que diga', 0, 0)).toBeNull();
  });
});
