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

export function getThemeColors(darkMode: boolean): ThemeColors {
  return darkMode ? darkColors : lightColors;
}
