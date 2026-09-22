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

  if (metadata.coverFileUri && metadata.coverExtension) {
    // Se escribe al lado y recién al final se reemplaza: si la extracción falla
    // (el archivo temporal de la tapa lo purgó Android), la portada que ya había
    // sigue estando. Antes se borraba primero y, si el move fallaba, la fila
    // quedaba apuntando a un archivo inexistente: portada rota en la biblioteca.
    const destination = `${getCoversDirectory()}/${bookId}${metadata.coverExtension}`;
    const staging = `${destination}.nueva`;
    const backup = `${destination}.vieja`;
    let backedUp = false;
    try {
      await ensureCoversDirectory();
      await FileSystem.deleteAsync(staging, { idempotent: true });
      // Primero se pone la nueva a salvo; recién entonces se toca la que había.
      await FileSystem.moveAsync({ from: metadata.coverFileUri, to: staging });
      await FileSystem.deleteAsync(backup, { idempotent: true });
      try {
        await FileSystem.moveAsync({ from: destination, to: backup });
        backedUp = true;
      } catch {
        // No había portada previa: nada que resguardar.
      }
      await FileSystem.moveAsync({ from: staging, to: destination });
      if (backedUp) await FileSystem.deleteAsync(backup, { idempotent: true }).catch(() => {});
      coverUri = destination;
    } catch {
      // Si el reemplazo falló a mitad, se devuelve la portada anterior a su
      // lugar: la fila la sigue nombrando (updateBookMetadata usa COALESCE) y
      // quedarse sin el archivo dejaba la tapa rota en la biblioteca.
      if (backedUp) {
        await FileSystem.moveAsync({ from: backup, to: destination }).catch(() => {});
      }
      await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => {});
      coverUri = null;
    }
  } else if (metadata.coverBase64 && metadata.coverExtension) {
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

  if (metadata.title || metadata.author || metadata.summary || coverUri) {
    await bookRepository.updateBookMetadata(bookId, {
      title: metadata.title,
      author: metadata.author,
      coverUri,
      summary: metadata.summary ?? null,
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
