/**
 * Velocidad de la narración: rango y cómo se mueve con los botones − / +.
 *
 * El paso es proporcional a la velocidad. Con un paso fijo de 0,1 la diferencia
 * entre 0,6x y 0,7x se nota muchísimo y entre 2,4x y 2,5x casi nada, y encima
 * llegar de punta a punta eran veinticinco toques.
 */
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

/** Paso hacia arriba desde `rate`: fino donde el oído distingue, grueso arriba. */
function stepAt(rate: number): number {
  if (rate < 1.2) return 0.1;
  if (rate < 2) return 0.15;
  return 0.25;
}

export function increaseRate(rate: number): number {
  return roundRate(Math.min(MAX_RATE, rate + stepAt(rate)));
}

export function decreaseRate(rate: number): number {
  // El paso de bajada es el del tramo en el que se va a caer, para que subir y
  // bajar vuelvan siempre al mismo valor.
  const target = rate - stepAt(rate);
  const step = stepAt(target);
  return roundRate(Math.max(MIN_RATE, rate - step));
}

function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

/** "1x", "0.95x", "2.5x" — sin ceros que no aportan. */
export function formatRate(rate: number): string {
  const rounded = roundRate(rate);
  return `${Number.isInteger(rounded) ? rounded : rounded.toString().replace(/0$/, '')}x`;
}
