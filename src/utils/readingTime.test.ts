import { describe, expect, it } from 'vitest';

import { estimateRemainingMinutes, formatRemaining, remainingLabel } from './readingTime';

describe('estimateRemainingMinutes', () => {
  it('un libro sin empezar tarda todo lo que mide', () => {
    // 300.000 caracteres a 1000 por minuto = 300 min.
    expect(estimateRemainingMinutes({ textLength: 300_000, percentage: 0 })).toBe(300);
  });

  it('por la mitad, la mitad', () => {
    expect(estimateRemainingMinutes({ textLength: 300_000, percentage: 50 })).toBe(150);
  });

  it('un libro terminado no muestra nada', () => {
    expect(estimateRemainingMinutes({ textLength: 300_000, percentage: 100 })).toBeNull();
    expect(estimateRemainingMinutes({ textLength: 300_000, percentage: 99.6 })).toBeNull();
  });

  it('sin datos del libro no se inventa un número', () => {
    expect(estimateRemainingMinutes({ textLength: null, percentage: 10 })).toBeNull();
    expect(estimateRemainingMinutes({ textLength: 0, percentage: 10 })).toBeNull();
    expect(estimateRemainingMinutes({ percentage: 10, isComic: true, pageCount: null })).toBeNull();
  });

  it('un cómic se mide en páginas, no en caracteres', () => {
    // 24 páginas × 25 s = 600 s = 10 min.
    expect(estimateRemainingMinutes({ isComic: true, pageCount: 24, percentage: 0 })).toBe(10);
    expect(estimateRemainingMinutes({ isComic: true, pageCount: 24, percentage: 50 })).toBe(5);
  });

  it('un porcentaje roto no rompe la cuenta', () => {
    expect(estimateRemainingMinutes({ textLength: 1000, percentage: NaN })).toBeNull();
    expect(estimateRemainingMinutes({ textLength: 1000, percentage: -50 })).toBe(1);
    expect(estimateRemainingMinutes({ textLength: 1000, percentage: 500 })).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('minutos sueltos', () => expect(formatRemaining(45)).toBe('~45 min'));
  it('horas justas', () => expect(formatRemaining(120)).toBe('~2 h'));
  it('horas y minutos', () => expect(formatRemaining(160)).toBe('~2 h 40'));
  it('minutos con dos dígitos', () => expect(formatRemaining(2167)).toBe('~36 h 07'));
  it('casi nada', () => expect(formatRemaining(0)).toBe('menos de 1 min'));
  it('sin dato', () => expect(formatRemaining(null)).toBeNull());
});

describe('remainingLabel', () => {
  it('arma el texto de punta a punta', () => {
    expect(remainingLabel({ textLength: 160_000, percentage: 0 })).toBe('~2 h 40');
    expect(remainingLabel({ textLength: 160_000, percentage: 100 })).toBeNull();
  });
});

describe('libros escaneados (sin texto que contar)', () => {
  it('un PDF escaneado se mide en páginas, no en su relleno', () => {
    // 4 páginas, solo texto provisorio: 4 × 90 s = 6 min.
    expect(estimateRemainingMinutes({ textLength: 60, pageCount: 4, percentage: 0 })).toBe(6);
  });

  it('un PDF con texto de verdad sigue midiéndose en caracteres', () => {
    expect(estimateRemainingMinutes({ textLength: 300_000, pageCount: 300, percentage: 0 })).toBe(300);
  });
});
