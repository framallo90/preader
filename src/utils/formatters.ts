const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Etiqueta de fecha relativa en español, SIN `Intl`.
 * Hermes (el motor JS de React Native) no incluye `Intl.RelativeTimeFormat`
 * ni `toLocaleDateString` con opciones, así que usarlos crashea en el dispositivo
 * ("Cannot read property 'prototype' of undefined"). Se formatea a mano.
 */
export function formatRelativeDateLabel(value: string) {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return '';
  }

  const diffMs = time - Date.now();
  const past = diffMs <= 0;
  const absMinutes = Math.round(Math.abs(diffMs) / (1000 * 60));

  if (absMinutes < 1) {
    return 'recién';
  }
  if (absMinutes < 60) {
    return past ? `hace ${absMinutes} min` : `en ${absMinutes} min`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return past ? `hace ${absHours} h` : `en ${absHours} h`;
  }

  const absDays = Math.round(absHours / 24);
  if (absDays < 7) {
    if (absDays === 1) {
      return past ? 'ayer' : 'mañana';
    }
    return past ? `hace ${absDays} días` : `en ${absDays} días`;
  }

  // Fecha absoluta corta, armada a mano (sin Intl).
  const day = date.getDate();
  const month = MONTHS_ES[date.getMonth()] ?? '';
  return `${day} ${month} ${date.getFullYear()}`;
}

/** Fecha corta en español ("7 ago 2026"), sin Intl. */
export function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const month = MONTHS_ES[date.getMonth()] ?? '';
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}

export function getDocumentTypeLabel(type: string | null) {
  if (!type) {
    return 'Archivo';
  }

  if (type.includes('pdf')) {
    return 'PDF';
  }

  return type.split('/').pop()?.toUpperCase() ?? 'Archivo';
}
