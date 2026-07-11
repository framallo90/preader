import { describe, it, expect } from 'vitest';

import { formatRelativeDateLabel, formatShortDate, getDocumentTypeLabel } from './formatters';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('formatRelativeDateLabel (sin Intl — no debe crashear en Hermes)', () => {
  it('minutos', () => expect(formatRelativeDateLabel(iso(5 * MIN))).toBe('hace 5 min'));
  it('horas', () => expect(formatRelativeDateLabel(iso(3 * HOUR))).toBe('hace 3 h'));
  it('ayer', () => expect(formatRelativeDateLabel(iso(DAY))).toBe('ayer'));
  it('días', () => expect(formatRelativeDateLabel(iso(3 * DAY))).toBe('hace 3 días'));
  it('recién', () => expect(formatRelativeDateLabel(iso(10_000))).toBe('recién'));
  it('fecha vieja → formato absoluto', () => {
    expect(formatRelativeDateLabel(iso(40 * DAY))).toMatch(/^\d{1,2} [a-zé]{3} \d{4}$/);
  });
  it('fecha inválida → vacío (no rompe el render)', () => {
    expect(formatRelativeDateLabel('no-es-fecha')).toBe('');
  });
});

describe('formatShortDate', () => {
  it('formatea corto en español', () => {
    expect(formatShortDate('2026-08-07T12:00:00Z')).toMatch(/^\d{1,2} ago 2026$/);
  });
  it('fecha inválida → vacío', () => expect(formatShortDate('x')).toBe(''));
});

describe('getDocumentTypeLabel', () => {
  it('pdf', () => expect(getDocumentTypeLabel('application/pdf')).toBe('PDF'));
  it('otro mime', () => expect(getDocumentTypeLabel('application/epub+zip')).toBe('EPUB+ZIP'));
  it('null → genérico', () => expect(getDocumentTypeLabel(null)).toBe('Archivo'));
});
