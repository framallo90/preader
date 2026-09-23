/**
 * "Seguir leyendo" teñido con el color de la tapa.
 *
 * El color sale de la tapa (lo calcula el módulo nativo UNA vez y se guarda).
 * Acá sólo se mezcla con el fondo de la tarjeta, poco: la idea es que la
 * tarjeta "se parezca" al libro, no que grite. El texto sigue con sus colores
 * de siempre, así que la mezcla tiene que dejarle contraste de sobra.
 */

/** En la base: null = todavía no se calculó; NO_COVER_COLOR = tapa gris, sin tinte. */
export const NO_COVER_COLOR = 'none';

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Mezcla `amount` (0..1) de `over` sobre `base`. */
export function mix(base: string, over: string, amount: number): string {
  const a = parseHex(base);
  const b = parseHex(over);
  if (!a || !b) return base;
  const t = Math.min(Math.max(amount, 0), 1);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Cuánto color de tapa entra al fondo: en oscuro se nota menos, se pone un poco más. */
const AMOUNT_LIGHT = 0.12;
const AMOUNT_DARK = 0.18;

export type CoverTint = { background: string; border: string };

/**
 * Fondo y borde de la tarjeta para una tapa. null si no hay color (tapa gris,
 * sin tapa, o todavía sin calcular): la tarjeta queda como siempre.
 *
 * Si con la mezcla el texto quedara con menos contraste que `minContrast`, se
 * va bajando la mezcla hasta que alcance: la legibilidad manda sobre el tinte.
 */
export function coverTint(
  coverColor: string | null | undefined,
  colors: { surface: string; border: string; text: string; textMuted: string },
  dark: boolean,
  minContrast = 4.5,
): CoverTint | null {
  if (!coverColor || coverColor === NO_COVER_COLOR || !parseHex(coverColor)) return null;
  let amount = dark ? AMOUNT_DARK : AMOUNT_LIGHT;
  while (amount > 0.02) {
    const background = mix(colors.surface, coverColor, amount);
    if (contrast(background, colors.text) >= minContrast && contrast(background, colors.textMuted) >= minContrast) {
      return { background, border: mix(colors.border, coverColor, Math.min(amount * 2.5, 0.6)) };
    }
    amount -= 0.02;
  }
  return null;
}
