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

describe('detectChapters — encabezados genéricos', () => {
  it('detecta "Capítulo N", "Parte II" y "Chapter", solo cuando están solos en su renglón', () => {
    const full = [
      'Capítulo I. Que trata de la condición del hidalgo',
      'En un lugar de la Mancha, de cuyo nombre no quiero acordarme. Dijo que el capítulo 3 era largo.',
      '',
      'PARTE II',
      'Texto de la segunda parte.',
      '',
      'Chapter 12',
      'Some text.',
    ].join(String.fromCharCode(10));
    const titles = detectChapters('bk', full).map((c) => c.title);
    expect(titles).toEqual(['Capítulo I. Que trata de la condición del hidalgo', 'PARTE II', 'Chapter 12']);
  });

  it('no toma prosa que empieza con la palabra capítulo si no hay línea en blanco antes', () => {
    const full = ['Intro.', 'Capítulo aparte, decía él, y siguió hablando de otra cosa por un rato largo hasta que se hizo de noche y todos se fueron.'].join(String.fromCharCode(10));
    expect(detectChapters('bk', full)).toEqual([]);
  });
});

describe('prosa que NO es un encabezado', () => {
  const NL = String.fromCharCode(10);

  // En un PDF los renglones vienen cortados y siempre hay una línea en blanco
  // antes de cada párrafo, así que estas frases cumplían las dos guardas.
  it('no toma prosa que arranca con parte / canto / section', () => {
    const prosa = [
      'Parte superior del cuerpo se movía apenas, mientras el sol caía.',
      'Canto rodado sobre la ladera del cerro, y el eco se perdió allá.',
      'Section headers were common in that old manual, he explained.',
    ];
    for (const linea of prosa) {
      const full = ['Algo anterior.', '', linea].join(NL);
      expect(detectChapters('bk', full)).toEqual([]);
    }
  });

  it('sigue detectando los encabezados de verdad', () => {
    const full = [
      'Algo anterior.',
      '',
      'Capítulo 8',
      'Prosa del capítulo ocho.',
      '',
      'Parte II',
      'Prosa de la parte dos.',
      '',
      'Libro primero',
      'Prosa del libro uno.',
      '',
      'CAPÍTULO XII. Del buen suceso',
      'Prosa del doce.',
    ].join(NL);
    expect(detectChapters('bk', full).map((c) => c.title)).toEqual([
      'Capítulo 8',
      'Parte II',
      'Libro primero',
      'CAPÍTULO XII. Del buen suceso',
    ]);
  });
});

describe('capítulos POV seguidos de prosa', () => {
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  // El encabezado POV viene precedido por una línea en blanco. Si esa marca no
  // se cierra, se filtra a la primera línea de la prosa y esa línea entra al
  // índice como un capítulo fantasma que parte el capítulo real en dos.
  it('la primera línea de la prosa no se cuela como capítulo', () => {
    const full = [
      'Texto previo de un párrafo cualquiera.',
      '',
      'BRAN' + TAB + '(1)',
      'Parte superior de su cuerpo temblaba mientras miraba el bosque.',
      'Siguió mirando un rato largo.',
    ].join(NL);
    const chapters = detectChapters('bk', full);
    expect(chapters.map((c) => c.title)).toEqual(['BRAN (1)']);
  });
});
