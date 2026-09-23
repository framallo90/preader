import { describe, expect, it } from 'vitest';

import { findCharacterCandidates, findMentions, mentionSnippet } from './characters';

const LIBRO = [
  'La noche era fría. Arya miró a Jon desde la muralla y Jon no dijo nada.',
  'Entonces bajaron. Después Arya habló con Sansa, pero Sansa no respondió.',
  'Arya volvió al patio. En el patio, Jon entrenaba con Robb.',
  'Mucho más tarde, Daenerys cruzó el mar. Daenerys, Daenerys, Daenerys.',
].join('\n');

const HASTA_EL_PATIO = LIBRO.indexOf('Mucho más tarde');

describe('findCharacterCandidates', () => {
  it('encuentra los nombres que se repiten', () => {
    const nombres = findCharacterCandidates(LIBRO, HASTA_EL_PATIO).map((c) => c.name);
    expect(nombres).toContain('Jon');
    expect(nombres).toContain('Arya');
  });

  it('no confunde con nombres las palabras que empiezan una oración', () => {
    const nombres = findCharacterCandidates(LIBRO, LIBRO.length).map((c) => c.name);
    expect(nombres).not.toContain('Entonces');
    expect(nombres).not.toContain('Después');
    expect(nombres).not.toContain('Mucho');
  });

  it('SIN SPOILERS: no aparece un personaje que todavía no leíste', () => {
    const nombres = findCharacterCandidates(LIBRO, HASTA_EL_PATIO).map((c) => c.name);
    expect(nombres).not.toContain('Daenerys');
  });

  it('con menos de tres menciones no cuenta como personaje', () => {
    const nombres = findCharacterCandidates(LIBRO, HASTA_EL_PATIO).map((c) => c.name);
    expect(nombres).not.toContain('Robb');
  });

  it('ordena por cantidad de menciones', () => {
    const [primero] = findCharacterCandidates(LIBRO, LIBRO.length);
    expect(primero.name).toBe('Daenerys');
  });

  it('recuerda dónde apareció por primera vez', () => {
    const jon = findCharacterCandidates(LIBRO, LIBRO.length).find((c) => c.name === 'Jon');
    expect(jon?.firstChar).toBe(LIBRO.indexOf('Jon'));
  });

  it('ignora títulos en mayúsculas y tratamientos', () => {
    const texto = 'y vino Señor y Señor y Señor. y dijo CAPITULO y CAPITULO y CAPITULO.';
    const nombres = findCharacterCandidates(texto, texto.length).map((c) => c.name);
    expect(nombres).not.toContain('Señor');
    expect(nombres).not.toContain('CAPITULO');
  });
});

describe('findMentions', () => {
  it('encuentra cada mención hasta donde leíste', () => {
    expect(findMentions(LIBRO, 'Jon', HASTA_EL_PATIO)).toHaveLength(3);
  });

  it('SIN SPOILERS: no cuenta las menciones de más adelante', () => {
    expect(findMentions(LIBRO, 'Daenerys', HASTA_EL_PATIO)).toHaveLength(0);
    expect(findMentions(LIBRO, 'Daenerys', LIBRO.length)).toHaveLength(4);
  });

  it('sólo palabras enteras', () => {
    expect(findMentions('Jonás y Jon', 'Jon', 99)).toEqual([{ start: 8, end: 11 }]);
  });

  it('distingue mayúsculas: "Rosa" no es "rosa"', () => {
    expect(findMentions('una rosa para Rosa', 'Rosa', 99)).toHaveLength(1);
  });
});

describe('mentionSnippet', () => {
  it('muestra el contexto con puntos suspensivos donde se corta', () => {
    const texto = `${'x '.repeat(100)}Arya ${'y '.repeat(100)}`;
    const [m] = findMentions(texto, 'Arya', texto.length);
    const s = mentionSnippet(texto, m, 10);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('Arya');
  });
});

describe('findCharacterCandidates: palabras comunes', () => {
  it('descarta una palabra que aparece seguido en minúscula', () => {
    const texto = 'dijo que Nunca y Nunca y Nunca. nunca nunca nunca nunca.';
    expect(findCharacterCandidates(texto, texto.length).map((c) => c.name)).not.toContain('Nunca');
  });

  it('un nombre que sólo encabeza oraciones no tiene prueba de ser nombre', () => {
    const texto = 'Ayer fue. Ayer volvió. Ayer se fue.';
    expect(findCharacterCandidates(texto, texto.length)).toEqual([]);
  });
});

describe('findCharacterCandidates: adverbios después de punto y coma', () => {
  it('"Finalmente" casi siempre encabeza: no es un nombre aunque a veces vaya en medio', () => {
    const texto = 'Finalmente llegó. Finalmente habló. Finalmente calló; y dijo: Finalmente. Ana vio a Ana y a Ana.';
    const nombres = findCharacterCandidates(texto, texto.length).map((c) => c.name);
    expect(nombres).not.toContain('Finalmente');
  });
});
