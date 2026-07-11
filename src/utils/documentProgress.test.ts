import { describe, it, expect } from 'vitest';

import { ParsedDocument } from '../types/document';
import { buildTextBlocks } from './textBlocks';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from './documentProgress';

function makeDoc(text: string): ParsedDocument {
  return { id: 't', fileName: 't.txt', sourceUri: '', fullText: text, blocks: buildTextBlocks(text), chapters: [] };
}

const full =
  'Uno dos tres cuatro cinco. Seis siete ocho nueve diez once. Doce trece catorce quince dieciseis.\n\n' +
  'Segundo parrafo con bastantes palabras para forzar mas de un bloque en la division.';
const doc = makeDoc(full);

describe('documentProgress', () => {
  it('documento nulo → todo en cero', () => {
    expect(getAbsoluteCharIndex(null, 3, 5)).toBe(0);
    expect(getPositionFromAbsoluteChar(null, 10)).toEqual({
      absoluteCharIndex: 0,
      blockIndex: 0,
      charIndex: 0,
      percentage: 0,
    });
  });

  it('round-trip: un punto dentro de cada bloque vuelve al mismo offset', () => {
    expect(doc.blocks.length).toBeGreaterThan(1);
    for (const b of doc.blocks) {
      const mid = b.startChar + Math.floor(b.text.length / 2);
      const pos = getPositionFromAbsoluteChar(doc, mid);
      const back = getAbsoluteCharIndex(doc, pos.blockIndex, pos.charIndex);
      expect(back).toBe(mid);
    }
  });

  it('clampa índices fuera de rango', () => {
    expect(getAbsoluteCharIndex(doc, 999, 999)).toBeLessThanOrEqual(full.length);
    expect(getPositionFromAbsoluteChar(doc, 999999).absoluteCharIndex).toBe(full.length);
    expect(getPositionFromAbsoluteChar(doc, -5).absoluteCharIndex).toBe(0);
  });

  it('el porcentaje va de 0 a 100', () => {
    expect(getPositionFromAbsoluteChar(doc, 0).percentage).toBe(0);
    expect(getPositionFromAbsoluteChar(doc, full.length).percentage).toBe(100);
  });
});
