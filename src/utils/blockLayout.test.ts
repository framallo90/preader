import { describe, expect, it } from 'vitest';

import { TextBlock } from '../types/document';
import { BlockLayoutCache, estimateBlockHeight } from './blockLayout';

const params = { fontSize: 18, lineHeightScale: 1.68, textWidth: 320, verticalExtra: 16 };

function blocks(texts: string[]): TextBlock[] {
  let start = 0;
  return texts.map((text, index) => {
    const block = { index, text, startChar: start, endChar: start + text.length };
    start += text.length + 2;
    return block;
  });
}

describe('estimateBlockHeight', () => {
  it('crece con el largo del texto y respeta los renglones duros', () => {
    const one = estimateBlockHeight('Hola.', params);
    const long = estimateBlockHeight('x'.repeat(400), params);
    const twoLines = estimateBlockHeight('Hola\nchau', params);
    expect(one).toBe(Math.round(18 * 1.68) + 16);
    expect(long).toBeGreaterThan(one * 5);
    expect(twoLines).toBe(2 * Math.round(18 * 1.68) + 16);
  });
});

describe('BlockLayoutCache', () => {
  const cache = () => new BlockLayoutCache(blocks(['a'.repeat(50), 'b'.repeat(500), 'c', 'd'.repeat(120)]), params);

  it('los offsets son sumas acumuladas de los altos', () => {
    const c = cache();
    const l0 = c.getItemLayout(0);
    const l1 = c.getItemLayout(1);
    const l2 = c.getItemLayout(2);
    expect(l0.offset).toBe(0);
    expect(l1.offset).toBe(l0.length);
    expect(l2.offset).toBe(l0.length + l1.length);
    expect(c.totalHeight()).toBe(l2.offset + l2.length + c.getItemLayout(3).length);
  });

  it('medir un bloque corrige su alto y los offsets siguientes, no los anteriores', () => {
    const c = cache();
    const before1 = c.getItemLayout(1);
    const before3 = c.getItemLayout(3);
    expect(c.measure(1, 900)).toBe(true);
    expect(c.isMeasured(1)).toBe(true);
    expect(c.getItemLayout(1)).toEqual({ ...before1, length: 900 });
    expect(c.getItemLayout(3).offset).toBe(before3.offset + (900 - before1.length));
    expect(c.getItemLayout(0).offset).toBe(0);
  });

  it('medir lo mismo dos veces no cambia nada; medidas inválidas se ignoran', () => {
    const c = cache();
    expect(c.measure(2, 40)).toBe(true);
    expect(c.measure(2, 40)).toBe(false);
    expect(c.measure(2, 0)).toBe(false);
    expect(c.measure(99, 40)).toBe(false);
  });

  it('un índice fuera de rango devuelve el último bloque', () => {
    const c = cache();
    expect(c.getItemLayout(50).offset).toBe(c.getItemLayout(3).offset);
  });
});
