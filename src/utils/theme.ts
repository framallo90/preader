export const lightColors = {
  background: '#f7f4ee',
  surface: '#fffdf9',
  surfaceMuted: '#f1ebe2',
  readerSurface: '#fcf8f2',
  readerAccent: '#e5efea',
  text: '#253038',
  textMuted: '#69757d',
  border: '#dfd7cb',
  primary: '#5f8c84',
  primaryText: '#f7f4ee',
  accent: '#e6f1ec',
  danger: '#b35f56',
  highlight: '#f7e8ad',
  highlightText: '#5a4700',
  shadow: 'rgba(40, 48, 55, 0.08)',
  scrim: 'rgba(30, 35, 40, 0.34)',
};

export const darkColors = {
  background: '#161915',
  surface: '#1e221d',
  surfaceMuted: '#292e27',
  readerSurface: '#1b1e19',
  readerAccent: '#283a34',
  text: '#f2efe7',
  textMuted: '#b4b6ab',
  border: '#343a31',
  primary: '#90b8ae',
  primaryText: '#102018',
  accent: '#22312c',
  danger: '#e6a39a',
  highlight: '#7b6530',
  highlightText: '#f8ecc4',
  shadow: 'rgba(0, 0, 0, 0.22)',
  scrim: 'rgba(0, 0, 0, 0.5)',
};

export type ThemeColors = typeof lightColors;

/** Papel envejecido: mismo esquema claro con fondo cálido y tinta marrón. */
export const sepiaColors: ThemeColors = {
  ...lightColors,
  background: '#efe6d0',
  surface: '#f7f0dc',
  surfaceMuted: '#e9dfc6',
  readerSurface: '#f4ecd8',
  readerAccent: '#e6dcc0',
  text: '#433422',
  textMuted: '#7a6a55',
  border: '#ddd0b3',
  highlight: '#ecd9a0',
  highlightText: '#4a3a10',
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
