import { describe, expect, it } from 'vitest';

import { hasUsefulStem, wordStem } from './wordStem';

describe('wordStem', () => {
  it('saca terminaciones de verbo', () => {
    expect(wordStem('correr')).toBe('corr');
    expect(wordStem('corriendo')).toBe('corr');
    expect(wordStem('corrieron')).toBe('corr');
    expect(wordStem('cantaba')).toBe('cant');
    expect(wordStem('cantando')).toBe('cant');
  });

  it('saca plurales y terminaciones de sustantivo', () => {
    // La raíz no es la palabra "correcta": es el tronco que comparten las formas.
    expect(wordStem('caballeros')).toBe('caballer'); // caballero, caballeros, caballería
    expect(wordStem('canciones')).toBe('cancion'); // canción, canciones, cancionero
    expect(wordStem('rapidamente')).toBe('rapida');
  });

  it('gana la terminación más larga, esté donde esté en la lista', () => {
    // "ciones" es más larga que "es", pero dejaría una raíz de 3 letras: se usa
    // la siguiente que sí entra.
    expect(wordStem('canciones')).toBe('cancion');
    expect(wordStem('habitaciones')).toBe('habita');
  });

  it('nunca deja una raíz demasiado corta', () => {
    // "casa" quedaría en "cas" (3): no se toca.
    expect(wordStem('casa')).toBe('casa');
    expect(wordStem('ir')).toBe('ir');
    expect(wordStem('ojos')).toBe('ojos');
  });

  it('una palabra sin terminación conocida queda igual', () => {
    expect(wordStem('quijote')).toBe('quijote');
    expect(wordStem('molino')).toBe('molin'); // sí tiene 'o' y la raíz aguanta
    expect(wordStem('sol')).toBe('sol');
  });
});

describe('hasUsefulStem', () => {
  it('es true solo si la raíz dice algo distinto', () => {
    expect(hasUsefulStem('correr')).toBe(true);
    expect(hasUsefulStem('casa')).toBe(false);
    expect(hasUsefulStem('sol')).toBe(false);
  });
});
