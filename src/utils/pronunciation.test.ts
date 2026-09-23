import { describe, expect, it } from 'vitest';

import { applyPronunciations, cleanPronunciations, textSignature } from './pronunciation';

describe('applyPronunciations', () => {
  const dic = [{ from: 'Qhorin', to: 'Corin' }];

  it('cambia la palabra', () => {
    expect(applyPronunciations('Llegó Qhorin al muro.', dic)).toBe('Llegó Corin al muro.');
  });

  it('cambia todas las apariciones', () => {
    expect(applyPronunciations('Qhorin y Qhorin', dic)).toBe('Corin y Corin');
  });

  it('no distingue mayúsculas', () => {
    expect(applyPronunciations('QHORIN MEDIAMANO', dic)).toBe('Corin MEDIAMANO');
  });

  it('sólo palabras enteras: "Jon" no toca "Jonás"', () => {
    expect(applyPronunciations('Jon y Jonás', [{ from: 'Jon', to: 'Yon' }])).toBe('Yon y Jonás');
  });

  it('tampoco toca la palabra pegada a letras con tilde', () => {
    expect(applyPronunciations('Jonás Jon', [{ from: 'Jon', to: 'Yon' }])).toBe('Jonás Yon');
  });

  it('respeta la puntuación alrededor', () => {
    expect(applyPronunciations('—¿Qhorin?', dic)).toBe('—¿Corin?');
  });

  it('la frase más larga gana sobre la palabra suelta', () => {
    const d = [{ from: 'Jon', to: 'Yon' }, { from: 'Jon Nieve', to: 'Yon Snou' }];
    expect(applyPronunciations('Jon Nieve y Jon', d)).toBe('Yon Snou y Yon');
  });

  it('escapa caracteres especiales del término', () => {
    expect(applyPronunciations('Dr. House', [{ from: 'Dr.', to: 'Doctor' }])).toBe('Doctor House');
    expect(applyPronunciations('Drx House', [{ from: 'Dr.', to: 'Doctor' }])).toBe('Drx House');
  });

  it('sin diccionario devuelve el mismo texto', () => {
    expect(applyPronunciations('hola', [])).toBe('hola');
  });
});

describe('cleanPronunciations', () => {
  it('descarta vacías, repetidas y las que no cambian nada', () => {
    const out = cleanPronunciations([
      { from: ' ', to: 'x' },
      { from: 'Qhorin', to: 'Corin' },
      { from: 'qhorin', to: 'Otro' },
      { from: 'Arya', to: 'arya' },
    ]);
    expect(out).toEqual([{ from: 'Qhorin', to: 'Corin' }]);
  });
});

describe('textSignature', () => {
  it('es estable', () => {
    expect(textSignature('Corin')).toBe(textSignature('Corin'));
  });

  it('cambia si cambia el texto', () => {
    expect(textSignature('Corin')).not.toBe(textSignature('Qhorin'));
  });
});
