import { describe, it, expect } from 'vitest';

import { prepareSpeechText } from './speechText';

const NL = String.fromCharCode(10);

describe('prepareSpeechText', () => {
  it('une los renglones cortados en medio de la oración', () => {
    const text = ['lo logrado en la cultura, es sólo la vuelta', 'táctica que hemos de tomar para volver.'].join(NL);
    expect(prepareSpeechText(text)).toBe('lo logrado en la cultura, es sólo la vuelta táctica que hemos de tomar para volver.');
  });

  it('conserva el largo exacto (la posición de la voz se calcula por proporción)', () => {
    const text = [
      'CAPÍTULO UNO',
      '',
      'Los egipcios creían que el valle del Nilo era todo el mundo y',
      'semejante afirmación de la circunstancia es monstruosa.',
      'Otra oración que sigue acá y que también tiene su largo',
      'razonable para un renglón.',
    ].join(NL);
    expect(prepareSpeechText(text)).toHaveLength(text.length);
  });

  it('conserva el salto de párrafo', () => {
    const text = ['Termina un párrafo largo con su punto final bien puesto.', '', 'Empieza otro párrafo.'].join(NL);
    expect(prepareSpeechText(text)).toBe(text);
  });

  it('conserva el salto después de una línea que cierra la oración', () => {
    const text = ['El rey calló y miró hacia el norte durante un buen rato.', 'Nadie dijo nada.'].join(NL);
    expect(prepareSpeechText(text)).toBe(text);
  });

  it('conserva el salto después de un título (línea corta sin puntuación)', () => {
    const text = ['MEDITACIÓN PRELIMINAR', 'El Monasterio del Escorial se levanta sobre un collado.'].join(NL);
    expect(prepareSpeechText(text)).toBe(text);
  });

  it('no toca un texto sin saltos de línea', () => {
    expect(prepareSpeechText('Una sola línea.')).toBe('Una sola línea.');
    expect(prepareSpeechText('')).toBe('');
  });
});
