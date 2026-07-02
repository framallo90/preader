import { getDatabase } from './database';
import { Character } from '../types/storage';

type CharacterRow = {
  id: string;
  sagaId: string | null;
  name: string;
  aliases: string;
  house: string | null;
  description: string | null;
  firstSeenBookId: string | null;
  firstSeenChapterId: string | null;
  updatedAt: string;
};

function mapCharacterRow(row: CharacterRow): Character {
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(row.aliases) as string[];
  } catch {
    aliases = [];
  }

  return {
    id: row.id,
    sagaId: row.sagaId,
    name: row.name,
    aliases,
    house: row.house,
    description: row.description,
    firstSeenBookId: row.firstSeenBookId,
    firstSeenChapterId: row.firstSeenChapterId,
    updatedAt: row.updatedAt,
  };
}

export const characterRepository = {
  async upsertCharacter(character: Character): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO characters (id, sagaId, name, aliases, house, description, firstSeenBookId, firstSeenChapterId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         aliases = excluded.aliases,
         house = excluded.house,
         description = excluded.description,
         firstSeenBookId = COALESCE(firstSeenBookId, excluded.firstSeenBookId),
         firstSeenChapterId = COALESCE(firstSeenChapterId, excluded.firstSeenChapterId),
         updatedAt = excluded.updatedAt`,
      [
        character.id,
        character.sagaId ?? null,
        character.name,
        JSON.stringify(character.aliases),
        character.house ?? null,
        character.description ?? null,
        character.firstSeenBookId ?? null,
        character.firstSeenChapterId ?? null,
        character.updatedAt,
      ],
    );
  },

  async getCharacterById(id: string): Promise<Character | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CharacterRow>(
      'SELECT * FROM characters WHERE id = ?',
      [id],
    );
    return row ? mapCharacterRow(row) : null;
  },

  async findCharacterByName(name: string, sagaId?: string): Promise<Character | null> {
    const db = await getDatabase();
    const query = sagaId
      ? 'SELECT * FROM characters WHERE (name = ? OR aliases LIKE ?) AND sagaId = ? LIMIT 1'
      : 'SELECT * FROM characters WHERE name = ? OR aliases LIKE ? LIMIT 1';
    const params = sagaId
      ? [name, `%"${name}"%`, sagaId]
      : [name, `%"${name}"%`];

    const row = await db.getFirstAsync<CharacterRow>(query, params);
    return row ? mapCharacterRow(row) : null;
  },

  async listCharactersForSaga(sagaId: string): Promise<Character[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CharacterRow>(
      'SELECT * FROM characters WHERE sagaId = ? ORDER BY name ASC',
      [sagaId],
    );
    return rows.map(mapCharacterRow);
  },

  /**
   * Lista personajes que aparecen por primera vez en un libro dado.
   * Úsalo cuando el libro no tiene saga asignada (sagaId = null).
   */
  async listCharactersForBook(bookId: string): Promise<Character[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CharacterRow>(
      'SELECT * FROM characters WHERE firstSeenBookId = ? ORDER BY name ASC',
      [bookId],
    );
    return rows.map(mapCharacterRow);
  },

  /**
   * Lista todos los personajes acumulados para una saga o para todos los libros
   * de un conjunto. Si sagaId es null, agrupa por libros del mismo sagaId null.
   * Para uso en pantalla de personajes cuando sagaId puede ser null.
   */
  async listCharactersBySagaOrBook(sagaId: string | null, bookId: string): Promise<Character[]> {
    const db = await getDatabase();
    if (sagaId) {
      const rows = await db.getAllAsync<CharacterRow>(
        'SELECT * FROM characters WHERE sagaId = ? ORDER BY name ASC',
        [sagaId],
      );
      return rows.map(mapCharacterRow);
    }
    // Sin saga: devuelve personajes del libro específico
    const rows = await db.getAllAsync<CharacterRow>(
      'SELECT * FROM characters WHERE firstSeenBookId = ? ORDER BY name ASC',
      [bookId],
    );
    return rows.map(mapCharacterRow);
  },
};
