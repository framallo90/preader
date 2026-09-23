import { describe, expect, it } from 'vitest';

import { buildMapMarkers, pagedScale, resolveMapTap } from './bookMap';

const CAPS = [{ startChar: 0 }, { startChar: 2500 }, { startChar: 5000 }];

describe('buildMapMarkers', () => {
  it('ubica capítulos y notas en fracción del libro', () => {
    const m = buildMapMarkers(10000, CAPS, [{ type: 'quote', charIndex: 7500 }]);
    expect(m.map((x) => [x.kind, x.fraction])).toEqual([
      ['chapter', 0.25],
      ['chapter', 0.5],
      ['note', 0.75],
    ]);
  });

  it('no dibuja el primer capítulo, que arranca pegado al borde', () => {
    expect(buildMapMarkers(10000, [{ startChar: 0 }], []).length).toBe(0);
  });

  it('distingue marcadores de notas y citas', () => {
    const m = buildMapMarkers(100, [], [{ type: 'bookmark', charIndex: 10 }, { type: 'note', charIndex: 20 }]);
    expect(m.map((x) => x.kind)).toEqual(['bookmark', 'note']);
  });

  it('un libro vacío no tiene marcas', () => {
    expect(buildMapMarkers(0, CAPS, [{ type: 'quote', charIndex: 5 }])).toEqual([]);
  });

  it('una nota más allá del final queda en el borde', () => {
    expect(buildMapMarkers(100, [], [{ type: 'quote', charIndex: 500 }])[0].fraction).toBe(1);
  });
});

describe('resolveMapTap', () => {
  const marcas = buildMapMarkers(10000, CAPS, [{ type: 'bookmark', charIndex: 5100 }]);

  it('tocando cerca de un marcador salta EXACTO al marcador', () => {
    expect(resolveMapTap(0.52, marcas, 10000)).toBe(5100);
  });

  it('el marcador gana sobre un capítulo que también está cerca', () => {
    // 0.5 es el capítulo y 0.51 el marcador: los dos cerca del toque.
    expect(resolveMapTap(0.5, marcas, 10000)).toBe(5100);
  });

  it('cerca de un capítulo sin notas salta al comienzo del capítulo', () => {
    expect(resolveMapTap(0.26, marcas, 10000)).toBe(2500);
  });

  it('lejos de todo salta al punto tocado', () => {
    expect(resolveMapTap(0.9, marcas, 10000)).toBe(Math.round(0.9 * 9999));
  });

  it('un toque fuera del ancho queda en los bordes', () => {
    expect(resolveMapTap(-1, [], 100)).toBe(0);
    expect(resolveMapTap(2, [], 100)).toBe(99);
  });
});

describe('pagedScale (PDF)', () => {
  // 4 páginas: casi todo el texto en la primera, las otras con poquito.
  const offsets = [0, 9000, 9500, 9800];
  const escala = pagedScale(offsets, 10000);

  it('ubica por PÁGINA, no por cantidad de texto', () => {
    expect(escala.toFraction(9000)).toBe(0.25);
    expect(escala.toFraction(9800)).toBe(0.75);
  });

  it('dentro de una página avanza proporcional', () => {
    expect(escala.toFraction(4500)).toBeCloseTo(0.125);
  });

  it('tocar la mitad del mapa lleva a la mitad de las páginas', () => {
    expect(escala.toChar(0.5)).toBe(9500);
  });

  it('ida y vuelta queda en el mismo lugar', () => {
    for (const c of [0, 1234, 9000, 9650, 9999]) {
      expect(escala.toChar(escala.toFraction(c))).toBe(c);
    }
  });

  it('páginas sin texto (láminas) igual ocupan su lugar', () => {
    const conLaminas = pagedScale([0, 100, 100, 100], 200);
    expect(conLaminas.toFraction(100)).toBe(0.75);
    expect(conLaminas.toChar(0.3)).toBe(100);
  });

  it('las marcas de un PDF salen en fracción de páginas', () => {
    const m = buildMapMarkers(escala, [{ startChar: 9500 }], []);
    expect(m[0].fraction).toBe(0.5);
  });
});

describe('buildMapMarkers con muchos capítulos', () => {
  it('no amontona rayas: una cada tanto como mucho', () => {
    const caps = Array.from({ length: 200 }, (_, i) => ({ startChar: (i + 1) * 50 }));
    const m = buildMapMarkers(10000, caps, []);
    expect(m.length).toBeLessThan(70);
    for (let i = 1; i < m.length; i += 1) expect(m[i].fraction - m[i - 1].fraction).toBeGreaterThanOrEqual(0.015);
  });

  it('las notas no se descartan aunque estén pegadas', () => {
    const m = buildMapMarkers(10000, [], [{ type: 'quote', charIndex: 100 }, { type: 'quote', charIndex: 101 }]);
    expect(m.length).toBe(2);
  });
});
