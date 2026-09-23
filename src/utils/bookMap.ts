/**
 * El "mapa" del libro: dónde caen los capítulos, tus notas y tus marcadores a
 * lo largo del libro, para verlo de un vistazo y saltar tocando.
 *
 * Todo se ubica en fracciones 0..1 del texto, que es la misma unidad del
 * progreso y de la voz. Lógica pura: se prueba sin pantalla.
 */

export type MapMarkerKind = 'chapter' | 'bookmark' | 'note';

export type MapMarker = {
  kind: MapMarkerKind;
  /** 0..1 a lo largo del libro. */
  fraction: number;
  charIndex: number;
};

/** A menos de esto (en fracción del ancho) de una marca, el toque va a la marca. */
export const MAP_SNAP = 0.025;

/** Distancia mínima entre dos rayas de capítulo en el mapa. */
export const MIN_CHAPTER_GAP = 0.015;

/**
 * Cómo se pasa de una posición del texto a un punto del mapa y al revés.
 *
 * En un libro de texto es proporcional. En un PDF NO: el mapa tiene que ir por
 * PÁGINAS, igual que el porcentaje que ve el lector; si no, un PDF con mucho
 * texto al principio y láminas al final pone "la mitad" en la página 10 de 40.
 */
export type MapScale = {
  total: number;
  toFraction: (charIndex: number) => number;
  toChar: (fraction: number) => number;
};

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

export function linearScale(total: number): MapScale {
  return {
    total,
    toFraction: (c) => (total <= 0 ? 0 : clamp01(c / total)),
    toChar: (f) => Math.round(clamp01(f) * Math.max(total - 1, 0)),
  };
}

/** Escala por páginas: cada página ocupa lo mismo en el mapa, tenga el texto que tenga. */
export function pagedScale(pageOffsets: number[], total: number): MapScale {
  const pages = pageOffsets.length;
  if (pages === 0) return linearScale(total);
  const endOf = (p: number) => (p + 1 < pages ? pageOffsets[p + 1] : total);
  return {
    total,
    toFraction: (c) => {
      // La última página con inicio <= c (búsqueda binaria).
      let lo = 0;
      let hi = pages - 1;
      let p = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pageOffsets[mid] <= c) { p = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      const inicio = pageOffsets[p];
      const largo = endOf(p) - inicio;
      const dentro = largo > 0 ? clamp01((c - inicio) / largo) : 0;
      return clamp01((p + dentro) / pages);
    },
    toChar: (f) => {
      const x = clamp01(f) * pages;
      const p = Math.min(Math.floor(x), pages - 1);
      const inicio = pageOffsets[p];
      const largo = Math.max(endOf(p) - inicio, 0);
      return Math.min(Math.round(inicio + (x - p) * largo), Math.max(total - 1, 0));
    },
  };
}

const asScale = (s: number | MapScale): MapScale => (typeof s === 'number' ? linearScale(s) : s);

export function buildMapMarkers(
  scaleOrTotal: number | MapScale,
  chapters: { startChar: number }[] | undefined,
  notes: { type: string; charIndex: number }[],
): MapMarker[] {
  const scale = asScale(scaleOrTotal);
  if (scale.total <= 0) return [];
  const marcas: MapMarker[] = [];
  // El primer capítulo arranca en 0: una raya pegada al borde no dice nada.
  // Con muchos capítulos (el Quijote tiene 130) las rayas pegadas se vuelven
  // un código de barras: se deja una cada MIN_CHAPTER_GAP como mucho.
  let ultima = -1;
  for (const chapter of chapters ?? []) {
    if (chapter.startChar <= 0) continue;
    const fraction = scale.toFraction(chapter.startChar);
    if (ultima >= 0 && fraction - ultima < MIN_CHAPTER_GAP) continue;
    ultima = fraction;
    marcas.push({ kind: 'chapter', fraction, charIndex: chapter.startChar });
  }
  for (const note of notes) {
    marcas.push({
      kind: note.type === 'bookmark' ? 'bookmark' : 'note',
      fraction: scale.toFraction(note.charIndex),
      charIndex: note.charIndex,
    });
  }
  return marcas.sort((a, b) => a.fraction - b.fraction);
}

/**
 * A dónde saltar al tocar el mapa en `fraction`.
 *
 * Si el toque cae cerca de una nota o un marcador, se va EXACTO ahí: nadie
 * acierta con el dedo a una rayita de dos píxeles. Las notas ganan sobre los
 * capítulos, porque son lo que buscás al tocar el mapa. Si no hay nada cerca,
 * se va al punto tocado.
 */
/** La marca a la que "se pega" un toque en `fraction`, o null si no hay ninguna cerca. */
export function snapMapTap(fraction: number, markers: MapMarker[]): MapMarker | null {
  const f = clamp01(fraction);
  const cerca = (m: MapMarker) => Math.abs(m.fraction - f) <= MAP_SNAP;
  const masCercana = (lista: MapMarker[]) =>
    lista.reduce<MapMarker | null>(
      (mejor, m) => (!mejor || Math.abs(m.fraction - f) < Math.abs(mejor.fraction - f) ? m : mejor),
      null,
    );
  return (
    masCercana(markers.filter((m) => m.kind !== 'chapter' && cerca(m))) ??
    masCercana(markers.filter((m) => m.kind === 'chapter' && cerca(m)))
  );
}

export function resolveMapTap(fraction: number, markers: MapMarker[], scaleOrTotal: number | MapScale): number {
  const marca = snapMapTap(fraction, markers);
  return marca ? marca.charIndex : asScale(scaleOrTotal).toChar(fraction);
}
