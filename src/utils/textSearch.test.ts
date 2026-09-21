import { describe, it, expect } from 'vitest';

import { foldText, searchText } from './textSearch';

describe('foldText', () => {
  it('conserva el largo para que los índices sigan valiendo', () => {
    const text = 'El CAMIÓN llegó; la Ñandú también. ¿Qué pasó?';
    expect(foldText(text)).toHaveLength(text.length);
    expect(foldText(text)).toBe('el camion llego; la nandu tambien. ¿que paso?');
  });
});

describe('searchText', () => {
  const text = 'El camión llegó tarde. Nadie esperaba al CAMION, pero el camionero sonrió.';

  it('ignora tildes y mayúsculas', () => {
    const matches = searchText(text, 'camion');
    expect(matches).toHaveLength(3);
  });

  it('el índice apunta al texto original', () => {
    const [first, second] = searchText(text, 'CAMIÓN');
    expect(text.slice(first.index, first.index + 6)).toBe('camión');
    expect(text.slice(second.index, second.index + 6)).toBe('CAMION');
  });

  it('el snippet permite resaltar el match', () => {
    const [match] = searchText(text, 'esperaba');
    expect(match.snippet.slice(match.snippetMatchStart, match.snippetMatchStart + match.matchLength)).toBe('esperaba');
  });

  it('respeta el límite y descarta consultas de un carácter', () => {
    expect(searchText('a a a a a a', 'a')).toHaveLength(0);
    expect(searchText('ab ab ab ab ab', 'ab', 2)).toHaveLength(2);
  });

  it('acepta el texto plegado precalculado', () => {
    const folded = foldText(text);
    expect(searchText(text, 'sonrio', 10, folded)).toHaveLength(1);
  });
});
