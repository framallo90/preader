/**
 * Paleta de Bardo — "Tinta y lacre".
 *
 * La idea: tinta sobre papel y el lacre que sella la carta. Un solo color
 * accionable (tinta) y un solo color de avance/importancia (lacre).
 *
 * Dos capas con criterios distintos:
 *  - El CHROME de la app (Inicio, Ajustes, barras del lector) usa la tinta para
 *    lo accionable (botones, play, selección) y el lacre para lo que marca
 *    avance o importancia (progreso, marcadores, resaltado de la voz).
 *  - La SUPERFICIE DE LECTURA (papel del libro) se mantiene calma: blanco, sepia
 *    o negro, sin acentos que compitan con el texto.
 *
 * Todos los pares están verificados con la fórmula WCAG: texto >= 4,5:1 y
 * elementos de UI >= 3:1. La paleta anterior (defaults de Tailwind) fallaba en
 * el ámbar sobre fondo claro (1,99), en success (3,3) y en danger (3,9).
 * Ver docs/brand/bardo-marca.md.
 */
export const lightColors = {
  background: '#F6F2EA',
  surface: '#FFFDF8',
  surfaceMuted: '#EDE7DB',
  // Los tres papeles del lector están duplicados en PdfPageList (PAGE_BACKGROUND)
  // y en el tintado nativo de BardoPdfModule.kt: si cambian acá, cambian allá.
  readerSurface: '#FFFFFF',
  readerAccent: '#ECE8F6',
  text: '#1F1C2C',
  textMuted: '#655F72',
  border: '#DDD4C4',
  primary: '#3A3785',
  primaryText: '#FFFFFF',
  accent: '#E3E1F4',
  warm: '#B8492E',
  warmSoft: '#F6E1D8',
  success: '#2F7A4B',
  danger: '#A61E4D',
  highlight: '#F4D8CB',
  highlightText: '#5A1E0E',
  shadow: 'rgba(31, 28, 44, 0.10)',
  scrim: 'rgba(20, 18, 30, 0.45)',
};

export const darkColors = {
  background: '#131218',
  surface: '#1C1B23',
  surfaceMuted: '#26242F',
  readerSurface: '#121212',
  readerAccent: '#25233A',
  text: '#EEE9DF',
  textMuted: '#A9A3B4',
  border: '#34313F',
  primary: '#A7A3F2',
  primaryText: '#16143A',
  accent: '#2C2A55',
  warm: '#E8876A',
  warmSoft: '#3A2019',
  success: '#6FCF97',
  danger: '#F28BA8',
  highlight: '#5C2A1C',
  highlightText: '#FFE3D8',
  shadow: 'rgba(0, 0, 0, 0.35)',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export type ThemeColors = typeof lightColors;

/** Papel envejecido: mismo esquema claro con fondo cálido y tinta marrón. */
export const sepiaColors: ThemeColors = {
  ...lightColors,
  background: '#EFE6D0',
  surface: '#F7F0DC',
  surfaceMuted: '#E9DFC6',
  readerSurface: '#F4ECD8',
  readerAccent: '#E6DCC0',
  text: '#433422',
  textMuted: '#6E5E49',
  border: '#DDD0B3',
  accent: '#E2D6B8',
  warm: '#A8412A',
  highlight: '#EBCDB5',
  highlightText: '#4A2410',
};

export type ReadingMode = 'day' | 'sepia' | 'night';

/** 'auto' sigue al modo oscuro de la app; el resto fuerza el tema del lector. */
export function resolveReadingMode(theme: 'auto' | ReadingMode, darkMode: boolean): ReadingMode {
  if (theme === 'auto') return darkMode ? 'night' : 'day';
  return theme;
}

/** Colores del LECTOR (no de toda la app) para un modo de lectura. */
export function getReaderColors(mode: ReadingMode): ThemeColors {
  if (mode === 'night') return darkColors;
  if (mode === 'sepia') return sepiaColors;
  return lightColors;
}

export function getThemeColors(darkMode: boolean): ThemeColors {
  return darkMode ? darkColors : lightColors;
}

/** Radios y espaciados compartidos, para que todo el chrome se vea de la misma familia. */
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
