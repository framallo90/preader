import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../types/storage';
import { parseBackup, planRestore, portableSettings, shouldReplaceProgress } from './backupFormat';

const valido = {
  app: 'bardo',
  version: 1,
  exportedAt: '2026-09-23T00:00:00.000Z',
  books: [{ id: 'bk_1', name: 'uno.pdf' }],
  progress: [{ bookId: 'bk_1', blockIndex: 3, charIndex: 10, updatedAt: '2026-09-23T00:00:00.000Z' }],
  notes: [{ id: 'nt_1', bookId: 'bk_1', charIndex: 5 }],
  collections: [{ id: 'cl_1', name: 'Favoritos', bookIds: ['bk_1'] }],
  settings: { fontSize: 20 },
};

describe('portableSettings', () => {
  it('no se lleva las carpetas de la biblioteca (son permisos de este teléfono)', () => {
    const out = portableSettings({ ...DEFAULT_SETTINGS, libraryFolders: ['content://x'] });
    expect(out).not.toHaveProperty('libraryFolders');
  });

  it('no se lleva la voz elegida (puede no existir en el otro teléfono)', () => {
    const out = portableSettings({ ...DEFAULT_SETTINGS, defaultVoiceId: 'es-AR-x' });
    expect(out).not.toHaveProperty('defaultVoiceId');
  });

  it('sí se lleva lo que es preferencia tuya', () => {
    const out = portableSettings({ ...DEFAULT_SETTINGS, fontSize: 24, justifyText: true });
    expect(out.fontSize).toBe(24);
    expect(out.justifyText).toBe(true);
  });
});

describe('parseBackup', () => {
  it('lee un respaldo válido', () => {
    const out = parseBackup(JSON.stringify(valido));
    expect(out?.books).toHaveLength(1);
    expect(out?.notes).toHaveLength(1);
    expect(out?.collections[0].bookIds).toEqual(['bk_1']);
  });

  it('rechaza algo que no es un respaldo de Bardo', () => {
    expect(parseBackup('{"app":"otra-cosa"}')).toBeNull();
    expect(parseBackup('no es json')).toBeNull();
    expect(parseBackup('[]')).toBeNull();
  });

  it('descarta las entradas rotas pero conserva las buenas', () => {
    const roto = { ...valido, books: [{ id: 'bk_1', name: 'uno' }, { sinId: true }, null] };
    expect(parseBackup(JSON.stringify(roto))?.books).toHaveLength(1);
  });

  it('un archivo sin listas no explota', () => {
    const out = parseBackup(JSON.stringify({ app: 'bardo', version: 1 }));
    expect(out).not.toBeNull();
    expect(out?.books).toEqual([]);
    expect(out?.notes).toEqual([]);
  });

  it('una versión futura se lee igual, con lo que se entienda', () => {
    const futuro = { ...valido, version: 99, cosaNueva: [1, 2] };
    expect(parseBackup(JSON.stringify(futuro))?.books).toHaveLength(1);
  });

  it('los ajustes del archivo también se filtran', () => {
    const conCarpetas = { ...valido, settings: { fontSize: 20, libraryFolders: ['content://x'] } };
    const out = parseBackup(JSON.stringify(conCarpetas));
    expect(out?.settings).not.toHaveProperty('libraryFolders');
    expect(out?.settings.fontSize).toBe(20);
  });
});

describe('planRestore', () => {
  it('aplica lo de los libros que están y saltea el resto', () => {
    const plan = planRestore(
      [{ bookId: 'bk_1' }, { bookId: 'bk_fantasma' }, { bookId: 'bk_2' }],
      new Set(['bk_1', 'bk_2']),
    );
    expect(plan.apply).toHaveLength(2);
    expect(plan.skipped).toBe(1);
  });

  it('sin ningún libro conocido no aplica nada', () => {
    const plan = planRestore([{ bookId: 'bk_1' }], new Set<string>());
    expect(plan.apply).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});

describe('shouldReplaceProgress', () => {
  it('si no había nada, se restaura', () => {
    expect(shouldReplaceProgress(null, { updatedAt: '2026-01-01T00:00:00Z' })).toBe(true);
  });

  it('el respaldo más nuevo pisa al viejo', () => {
    expect(shouldReplaceProgress({ updatedAt: '2026-01-01T00:00:00Z' }, { updatedAt: '2026-06-01T00:00:00Z' })).toBe(true);
  });

  it('NO pisa un libro que seguiste leyendo después de exportar', () => {
    expect(shouldReplaceProgress({ updatedAt: '2026-06-01T00:00:00Z' }, { updatedAt: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('con fechas rotas prefiere no tocar lo que ya tenías', () => {
    expect(shouldReplaceProgress({ updatedAt: '2026-06-01T00:00:00Z' }, { updatedAt: 'vaya a saber' })).toBe(false);
  });

  it('si lo guardado tiene fecha rota, el respaldo gana', () => {
    expect(shouldReplaceProgress({ updatedAt: 'roto' }, { updatedAt: '2026-01-01T00:00:00Z' })).toBe(true);
  });
});

describe('parseBackup: estadísticas', () => {
  it('lee las filas válidas y descarta las rotas', () => {
    const raw = JSON.stringify({
      app: 'bardo',
      stats: [
        { bookId: 'a', day: '2026-09-23', mode: 'read', seconds: 120 },
        { bookId: 'a', day: 'ayer', mode: 'read', seconds: 120 },
        { bookId: 'a', day: '2026-09-23', mode: 'dormir', seconds: 120 },
        { bookId: 'a', day: '2026-09-23', mode: 'listen', seconds: -5 },
      ],
    });
    expect(parseBackup(raw)?.stats).toEqual([{ bookId: 'a', day: '2026-09-23', mode: 'read', seconds: 120 }]);
  });

  it('un respaldo viejo, sin estadísticas, igual se lee', () => {
    expect(parseBackup(JSON.stringify({ app: 'bardo' }))?.stats).toEqual([]);
  });
});
