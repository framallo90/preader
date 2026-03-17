export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundToPrecision(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clampRounded(value: number, min: number, max: number, digits = 2) {
  return roundToPrecision(clamp(value, min, max), digits);
}
