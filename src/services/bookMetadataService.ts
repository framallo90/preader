import * as FileSystem from 'expo-file-system/legacy';

import { DocumentMetadata } from '../types/document';
import { bookRepository } from '../storage/bookRepository';

function getCoversDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('Directorio de documentos no disponible.');
  }
  return `${FileSystem.documentDirectory}covers`;
}

async function ensureCoversDirectory(): Promise<void> {
  const dir = getCoversDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/**
 * Persiste la metadata extraída por el parser: escribe la portada como
 * archivo local (covers/{bookId}.jpg) y actualiza title/author/coverUri
 * en la fila del libro. Nunca pisa metadata existente con null.
 */
export async function persistBookMetadata(bookId: string, metadata: DocumentMetadata): Promise<void> {
  let coverUri: string | null = null;

  if (metadata.coverBase64 && metadata.coverExtension) {
    try {
      await ensureCoversDirectory();
      coverUri = `${getCoversDirectory()}/${bookId}${metadata.coverExtension}`;
      await FileSystem.writeAsStringAsync(coverUri, metadata.coverBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      coverUri = null;
    }
  }

  if (metadata.title || metadata.author || coverUri) {
    await bookRepository.updateBookMetadata(bookId, {
      title: metadata.title,
      author: metadata.author,
      coverUri,
    });
  }
}

/** Borra la portada cacheada de un libro (al eliminarlo de la biblioteca). */
export async function removeBookCover(bookId: string): Promise<void> {
  const dir = getCoversDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return;

  const files = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    files
      .filter((f) => f.startsWith(bookId))
      .map((f) => FileSystem.deleteAsync(`${dir}/${f}`, { idempotent: true })),
  );
}
