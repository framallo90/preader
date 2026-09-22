import { describe, expect, it } from 'vitest';

import { MAX_RATE, MIN_RATE, decreaseRate, formatRate, increaseRate } from './playbackRate';

describe('velocidad de la narración', () => {
  it('no se pasa de los topes', () => {
    expect(increaseRate(MAX_RATE)).toBe(MAX_RATE);
    expect(decreaseRate(MIN_RATE)).toBe(MIN_RATE);
    expect(increaseRate(2.95)).toBe(MAX_RATE);
    expect(decreaseRate(0.55)).toBe(MIN_RATE);
  });

  it('el paso es más fino abajo y más grueso arriba', () => {
    expect(increaseRate(1)).toBe(1.1);
    expect(increaseRate(1.5)).toBe(1.65);
    expect(increaseRate(2.5)).toBe(2.75);
  });

  it('subir y bajar vuelve al mismo valor', () => {
    for (const rate of [0.5, 0.9, 1, 1.2, 1.5, 2, 2.5, 3]) {
      const up = increaseRate(rate);
      if (up < MAX_RATE) expect(decreaseRate(up)).toBe(rate);
    }
  });

  it('recorre todo el rango en pocos toques', () => {
    let rate = MIN_RATE;
    let pasos = 0;
    while (rate < MAX_RATE && pasos < 100) {
      rate = increaseRate(rate);
      pasos += 1;
    }
    expect(rate).toBe(MAX_RATE);
    expect(pasos).toBeLessThanOrEqual(18);
  });

  it('nunca acumula basura decimal', () => {
    let rate = MIN_RATE;
    for (let i = 0; i < 20; i++) {
      rate = increaseRate(rate);
      expect(Number.isInteger(Math.round(rate * 100))).toBe(true);
    }
  });

  it('se muestra sin ceros de más', () => {
    expect(formatRate(1)).toBe('1x');
    expect(formatRate(0.95)).toBe('0.95x');
    expect(formatRate(1.5)).toBe('1.5x');
    expect(formatRate(2)).toBe('2x');
  });
});
