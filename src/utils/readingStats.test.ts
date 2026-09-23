import { describe, expect, it } from 'vitest';

import {
  computeStreak,
  countableSeconds,
  dayKey,
  formatDuration,
  splitMinutes,
  previousDay,
  summarize,
  weekStart,
} from './readingStats';

const fila = (day: string, seconds: number, mode: 'read' | 'listen' = 'read') => ({ day, mode, seconds });

describe('dayKey / previousDay', () => {
  it('arma la clave en hora local, con ceros', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('el día anterior cruza meses y años', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
    expect(previousDay('2024-03-01')).toBe('2024-02-29');
  });
});

describe('computeStreak', () => {
  it('cuenta días seguidos terminando hoy', () => {
    const rows = [fila('2026-09-21', 600), fila('2026-09-22', 600), fila('2026-09-23', 600)];
    expect(computeStreak(rows, '2026-09-23')).toBe(3);
  });

  it('si hoy todavía no leíste, la racha de ayer sigue viva', () => {
    const rows = [fila('2026-09-21', 600), fila('2026-09-22', 600)];
    expect(computeStreak(rows, '2026-09-23')).toBe(2);
  });

  it('un día salteado corta la racha', () => {
    const rows = [fila('2026-09-20', 600), fila('2026-09-22', 600), fila('2026-09-23', 600)];
    expect(computeStreak(rows, '2026-09-23')).toBe(2);
  });

  it('abrir y cerrar (menos de un minuto) no cuenta', () => {
    const rows = [fila('2026-09-22', 600), fila('2026-09-23', 20)];
    expect(computeStreak(rows, '2026-09-23')).toBe(1);
  });

  it('leer y escuchar el mismo día se suman', () => {
    const rows = [fila('2026-09-23', 30, 'read'), fila('2026-09-23', 40, 'listen')];
    expect(computeStreak(rows, '2026-09-23')).toBe(1);
  });

  it('sin nada, racha 0', () => {
    expect(computeStreak([], '2026-09-23')).toBe(0);
  });
});

describe('summarize', () => {
  it('suma leído y escuchado sólo dentro del rango', () => {
    const rows = [fila('2026-09-01', 100), fila('2026-09-10', 50, 'listen'), fila('2026-10-01', 999)];
    expect(summarize(rows, '2026-09-01', '2026-09-30')).toEqual({ read: 100, listen: 50, total: 150 });
  });
});

describe('formatDuration', () => {
  it('escribe horas y minutos', () => {
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe('3 h 20 min');
    expect(formatDuration(2 * 3600)).toBe('2 h');
    expect(formatDuration(45 * 60)).toBe('45 min');
  });

  it('distingue nada de casi nada', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(20)).toBe('menos de un minuto');
  });
});

describe('weekStart', () => {
  it('la semana arranca el lunes', () => {
    expect(weekStart(new Date(2026, 8, 23))).toBe('2026-09-21'); // miércoles → lunes 21
    expect(weekStart(new Date(2026, 8, 21))).toBe('2026-09-21'); // lunes
    expect(weekStart(new Date(2026, 8, 27))).toBe('2026-09-21'); // domingo
  });
});

describe('countableSeconds', () => {
  it('cuenta los intervalos normales', () => {
    expect(countableSeconds(5000, 15000)).toBe(5);
  });

  it('un hueco largo (app dormida) no es lectura', () => {
    expect(countableSeconds(10 * 60 * 1000, 15000)).toBe(0);
  });

  it('ignora relojes que van para atrás', () => {
    expect(countableSeconds(-3000, 15000)).toBe(0);
  });
});

describe('splitMinutes', () => {
  it('las partes suman el total que se muestra', () => {
    const { read, listen } = splitMinutes(406, 74);
    expect(read + listen).toBe(8);
    expect(listen).toBe(1);
  });

  it('dos mitades de minuto no suman de más', () => {
    const { read, listen } = splitMinutes(150, 150);
    expect(read + listen).toBe(5);
  });
});

describe('formatDuration redondea', () => {
  it('6 min 50 s son 7 min', () => {
    expect(formatDuration(410)).toBe('7 min');
  });
});
