import { getDatabase } from './database';
import { Saga } from '../types/storage';

type SagaRow = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

function mapSagaRow(row: SagaRow): Saga {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  };
}

export const sagaRepository = {
  async createSaga(saga: Saga): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO sagas (id, name, description, createdAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description`,
      [saga.id, saga.name, saga.description ?? null, saga.createdAt],
    );
  },

  async getSagaById(id: string): Promise<Saga | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SagaRow>(
      'SELECT id, name, description, createdAt FROM sagas WHERE id = ?',
      [id],
    );
    return row ? mapSagaRow(row) : null;
  },

  async listSagas(): Promise<Saga[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<SagaRow>(
      'SELECT id, name, description, createdAt FROM sagas ORDER BY createdAt ASC',
    );
    return rows.map(mapSagaRow);
  },

  async deleteSaga(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM sagas WHERE id = ?', [id]);
  },
};
