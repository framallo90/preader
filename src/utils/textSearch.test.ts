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

describe('plegado: el largo tiene que ser el mismo', () => {
  // De esto depende TODO: un índice en el texto plegado se usa como índice en el
  // original para armar el fragmento y para saltar a la posición.
  it('cualquier texto conserva su largo exacto', () => {
    const textos = [
      'El camión pasó por la esquina.',
      'Ángel, Óscar, Íñigo y Ünter fueron al café.',
      'Kraków, Plzeň, Gdańsk, Łódź, Straße.',
      'Sin acentos ni nada raro.',
      '',
      '  espacios raros — y guiones – largos',
    ];
    for (const texto of textos) {
      expect(foldText(texto).length).toBe(texto.length);
    }
  });

  it('pliega también el rango extendido (polaco, checo)', () => {
    expect(foldText('Łódź')).toBe('lodz');
    expect(foldText('Plzeň')).toBe('plzen');
    expect(foldText('CAFÉ')).toBe('cafe');
  });

  it('un texto largo da el mismo resultado que carácter por carácter', () => {
    const largo = 'El camión llegó tarde al café de Ángel. '.repeat(500);
    const esperado = Array.from(largo)
      .map((c) => foldText(c))
      .join('');
    expect(foldText(largo)).toBe(esperado);
  });
});

describe('buscar por raíz de palabra', () => {
  const texto = [
    'El caballero corría por el campo.',
    'Mientras corrían, el otro corrió detrás.',
    'Después se pusieron a correr de nuevo.',
    'El socorro llegó tarde.',
  ].join(' ');

  it('"correr" encuentra las formas conjugadas', () => {
    const encontrados = searchText(texto, 'correr').map((m) =>
      m.snippet.slice(m.snippetMatchStart, m.snippetMatchStart + m.matchLength),
    );
    expect(encontrados).toContain('corría');
    expect(encontrados).toContain('corrían');
    expect(encontrados).toContain('corrió');
    expect(encontrados).toContain('correr');
  });

  it('la raíz tiene que caer al COMIENZO de una palabra', () => {
    const encontrados = searchText(texto, 'correr').map((m) =>
      m.snippet.slice(m.snippetMatchStart, m.snippetMatchStart + m.matchLength),
    );
    // 'socorro' contiene 'corr' pero no empieza con la raíz.
    expect(encontrados.some((w) => w.includes('socorro'))).toBe(false);
  });

  it('una palabra sin terminación conocida busca igual que siempre', () => {
    const t = 'La casa de la casaquinta.';
    const encontrados = searchText(t, 'casa');
    // Búsqueda de texto común: encuentra las dos, incluida la de adentro.
    expect(encontrados.length).toBe(2);
  });

  it('una frase se busca tal cual, sin raíces', () => {
    const t = 'El caballero corría por el campo. Otro corría distinto.';
    expect(searchText(t, 'caballero corría').length).toBe(1);
  });

  it('los índices siguen apuntando al texto original', () => {
    for (const m of searchText(texto, 'correr')) {
      expect(m.index).toBeGreaterThanOrEqual(0);
      expect(m.index).toBeLessThan(texto.length);
    }
  });
});
