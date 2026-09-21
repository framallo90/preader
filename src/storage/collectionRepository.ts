import { getDatabase } from './database';
import { Collection } from '../types/storage';

type CollectionRow = { id: string; name: string; createdAt: string; bookCount: number };

function createCollectionId(): string {
  return `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Colecciones (estanterías): un libro puede estar en varias a la vez. */
export const collectionRepository = {
  async listCollections(): Promise<Collection[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CollectionRow>(
      `SELECT c.id, c.name, c.createdAt, COUNT(bc.bookId) AS bookCount
       FROM colls c LEFT JOIN books_to_colls bc ON bc.collId = c.id
       GROUP BY c.id ORDER BY c.name COLLATE NOCASE ASC`,
    );
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, bookCount: row.bookCount }));
  },

  async createCollection(name: string): Promise<Collection> {
    const db = await getDatabase();
    const collection: Collection = {
      id: createCollectionId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      bookCount: 0,
    };
    await db.runAsync('INSERT INTO colls (id, name, createdAt) VALUES (?, ?, ?)', [
      collection.id,
      collection.name,
      collection.createdAt,
    ]);
    return collection;
  },

  async removeCollection(collectionId: string): Promise<void> {
    const db = await getDatabase();
    // Los vínculos con libros se van por ON DELETE CASCADE; los libros quedan.
    await db.runAsync('DELETE FROM colls WHERE id = ?', [collectionId]);
  },

  async listCollectionIdsForBook(bookId: string): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ collId: string }>('SELECT collId FROM books_to_colls WHERE bookId = ?', [bookId]);
    return rows.map((row) => row.collId);
  },

  async listBookIdsInCollection(collectionId: string): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ bookId: string }>('SELECT bookId FROM books_to_colls WHERE collId = ?', [collectionId]);
    return rows.map((row) => row.bookId);
  },

  async setBookInCollection(bookId: string, collectionId: string, included: boolean): Promise<void> {
    const db = await getDatabase();
    if (included) {
      await db.runAsync('INSERT OR IGNORE INTO books_to_colls (bookId, collId) VALUES (?, ?)', [bookId, collectionId]);
    } else {
      await db.runAsync('DELETE FROM books_to_colls WHERE bookId = ? AND collId = ?', [bookId, collectionId]);
    }
  },
};
