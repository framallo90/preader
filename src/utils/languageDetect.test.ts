import { describe, it, expect } from 'vitest';

import { detectLanguage } from './languageDetect';

const repeat = (s: string, n: number) => Array.from({ length: n }, () => s).join(' ');

describe('detectLanguage', () => {
  it('detecta español', () => {
    const text = repeat('El rey miró por la ventana y no dijo nada, porque en el castillo había un silencio que lo cubría todo desde la mañana.', 12);
    expect(detectLanguage(text)).toBe('es');
  });

  it('detecta inglés', () => {
    const text = repeat('The king looked out of the window and said nothing, for in the castle there was a silence that had covered it all from the morning.', 12);
    expect(detectLanguage(text)).toBe('en');
  });

  it('detecta portugués sin confundirlo con español', () => {
    const text = repeat('O rei olhou pela janela e não disse nada, porque no castelo havia um silêncio que cobria tudo desde a manhã, mas ele não sabia o que fazer com os seus homens.', 12);
    expect(detectLanguage(text)).toBe('pt');
  });

  it('devuelve null sin evidencia suficiente', () => {
    expect(detectLanguage('')).toBeNull();
    expect(detectLanguage('12345 67890 --- ***')).toBeNull();
    expect(detectLanguage('Hola mundo')).toBeNull();
  });
});
