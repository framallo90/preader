import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, warmNightColors } from './theme';
import { NO_COVER_COLOR, contrast, coverTint, mix, parseHex } from './coverTint';

describe('mix', () => {
  it('0 deja la base y 1 pone el otro color', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('un color roto deja la base', () => {
    expect(mix('#123456', 'rojo', 0.5)).toBe('#123456');
  });
});

describe('coverTint', () => {
  it('sin color, tapa gris o color roto: la tarjeta queda como siempre', () => {
    expect(coverTint(null, lightColors, false)).toBeNull();
    expect(coverTint(NO_COVER_COLOR, lightColors, false)).toBeNull();
    expect(coverTint('#12', lightColors, false)).toBeNull();
  });

  it('tiñe el fondo hacia el color de la tapa', () => {
    const t = coverTint('#00A0A0', lightColors, false)!;
    expect(t.background).not.toBe(lightColors.surface);
    const [r, , b] = parseHex(t.background)!;
    const [r0, , b0] = parseHex(lightColors.surface)!;
    expect(r).toBeLessThan(r0); // se fue hacia el turquesa
    expect(b).toBeLessThanOrEqual(b0);
  });

  it('con cualquier tapa, el texto sigue legible (4,5:1) en los tres fondos', () => {
    const tapas = ['#FF0000', '#FFFF00', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#7F00FF', '#B8492E'];
    for (const [paleta, oscuro] of [[lightColors, false], [darkColors, true], [warmNightColors, true]] as const) {
      for (const tapa of tapas) {
        const t = coverTint(tapa, paleta, oscuro);
        if (!t) continue;
        expect(contrast(t.background, paleta.text)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.background, paleta.textMuted)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
