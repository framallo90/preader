import { describe, it, expect } from 'vitest';

import { cleanPdfProse, cleanPdfTabArtifacts, detectChapters } from './chapterDetector';

describe('cleanPdfTabArtifacts', () => {
  it('reemplaza tabs entre palabras por espacios', () => {
    expect(cleanPdfTabArtifacts('hola\tmundo cruel')).toBe('hola mundo cruel');
  });

  it('preserva el tab de un encabezado de capítulo POV', () => {
    expect(cleanPdfTabArtifacts('BRAN\t(1)')).toBe('BRAN\t(1)');
  });

  it('limpia el cuerpo pero deja intacto el encabezado', () => {
    const input = 'BRAN\t(1)\nel\tviento\tdel norte';
    expect(cleanPdfTabArtifacts(input)).toBe('BRAN\t(1)\nel viento del norte');
  });
});

describe('cleanPdfProse', () => {
  it('borra pies de página con URL', () => {
    expect(cleanPdfProse('Texto real.\nwww.lectulandia.com\nMás texto.')).toBe('Texto real.\n\nMás texto.');
  });

  it('borra líneas de "Página N" y números sueltos', () => {
    expect(cleanPdfProse('Hola.\nPágina 42\n17\nChau.')).toBe('Hola.\n\n\nChau.');
  });

  it('saca el espacio antes de la puntuación', () => {
    expect(cleanPdfProse('Dijo hola , y se fue .')).toBe('Dijo hola, y se fue.');
  });

  it('no toca el texto normal ni los encabezados de capítulo', () => {
    expect(cleanPdfProse('BRAN\t(1)\nEl viento del norte.')).toBe('BRAN\t(1)\nEl viento del norte.');
  });
});

describe('detectChapters', () => {
  const full = 'PRÓLOGO\nTexto del prólogo.\n\nBRAN\t(1)\nTexto de Bran.\n\nCATELYN\t(2)\nTexto de Catelyn.';
  const chapters = detectChapters('bk_x', full);

  it('detecta el especial y los dos POV', () => {
    expect(chapters.map((c) => c.title)).toEqual(['PRÓLOGO', 'BRAN (1)', 'CATELYN (2)']);
  });

  it('extrae personaje POV y número', () => {
    expect(chapters.map((c) => c.povCharacter)).toEqual([null, 'BRAN', 'CATELYN']);
    expect(chapters.map((c) => c.povNumber)).toEqual([null, 1, 2]);
  });

  it('genera ids e índices de orden estables', () => {
    expect(chapters.map((c) => c.id)).toEqual(['bk_x--ch-0', 'bk_x--ch-1', 'bk_x--ch-2']);
    expect(chapters.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('encadena endChar con el startChar del siguiente y cierra en fullText.length', () => {
    expect(chapters[0].endChar).toBe(chapters[1].startChar);
    expect(chapters[1].endChar).toBe(chapters[2].startChar);
    expect(chapters[2].endChar).toBe(full.length);
    expect(chapters[0].startChar).toBe(0);
  });

  it('no detecta capítulos si no hay encabezados', () => {
    expect(detectChapters('bk_y', 'Sólo texto corrido sin encabezados.')).toEqual([]);
  });
});
