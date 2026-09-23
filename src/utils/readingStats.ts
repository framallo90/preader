/**
 * Cuentas de las estadísticas de lectura: días, rachas y totales.
 *
 * Lógica pura sobre filas {día, modo, segundos}: se prueba sin base.
 * Los días son LOCALES ("2026-09-23" en tu zona horaria), no UTC: si leés a
 * las 23:30, cuenta para hoy y no para mañana.
 */

export type StatsMode = 'read' | 'listen';

export type DayRow = { day: string; mode: StatsMode; seconds: number };

/** Un día con menos que esto no cuenta para la racha: abrir y cerrar no es leer. */
export const STREAK_MIN_SECONDS = 60;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2026-09-23" en hora local. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** El día anterior a una clave, sin pasar por UTC (evita saltos por horario de verano). */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const fecha = new Date(y, m - 1, d, 12, 0, 0);
  fecha.setDate(fecha.getDate() - 1);
  return dayKey(fecha);
}

/**
 * Días seguidos leyendo o escuchando, terminando hoy.
 *
 * Si hoy todavía no leíste pero ayer sí, la racha sigue viva (el día no
 * terminó): cuenta desde ayer. Así no amanecés con "racha 0" a las 8 de la mañana.
 */
export function computeStreak(rows: DayRow[], today: string): number {
  const porDia = new Map<string, number>();
  for (const row of rows) porDia.set(row.day, (porDia.get(row.day) ?? 0) + row.seconds);
  const leyo = (day: string) => (porDia.get(day) ?? 0) >= STREAK_MIN_SECONDS;

  let dia = leyo(today) ? today : previousDay(today);
  let racha = 0;
  while (leyo(dia)) {
    racha += 1;
    dia = previousDay(dia);
  }
  return racha;
}

export type StatsSummary = { read: number; listen: number; total: number };

/** Segundos leídos y escuchados entre dos días, inclusive. */
export function summarize(rows: DayRow[], fromDay: string, toDay: string): StatsSummary {
  let read = 0;
  let listen = 0;
  for (const row of rows) {
    if (row.day < fromDay || row.day > toDay) continue;
    if (row.mode === 'read') read += row.seconds;
    else listen += row.seconds;
  }
  return { read, listen, total: read + listen };
}

/** "3 h 20 min", "45 min", "menos de un minuto". */
export function formatDuration(seconds: number): string {
  // Redondeado (no truncado): 6 min 50 s son "7 min", y las partes suman el total.
  const minutos = Math.round(seconds / 60);
  if (minutos < 1) return seconds > 0 ? 'menos de un minuto' : '0 min';
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${minutos} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Leído y escuchado en minutos enteros que SUMAN el total mostrado: redondear
 * cada parte por separado puede dar "6 + 1" al lado de un total de 8.
 */
export function splitMinutes(read: number, listen: number): { read: number; listen: number } {
  const total = Math.round((read + listen) / 60);
  const escuchado = Math.min(Math.round(listen / 60), total);
  return { read: total - escuchado, listen: escuchado };
}

/** Primer día de la semana (lunes) que contiene a `date`. */
export function weekStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const desdeLunes = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - desdeLunes);
  return dayKey(d);
}

/**
 * Cuánto sumar de un intervalo del reloj.
 *
 * Los avisos llegan cada tanto; si entre dos pasó mucho (la app estuvo
 * dormida, el teléfono en el bolsillo), ese hueco NO es tiempo de lectura.
 */
export function countableSeconds(deltaMs: number, maxGapMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > maxGapMs) return 0;
  return deltaMs / 1000;
}
