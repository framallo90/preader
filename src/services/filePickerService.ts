import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { bookRepository } from '../storage/bookRepository';
import { Book, NEW_BOOK_DEFAULTS } from '../types/storage';
import { createBookFingerprint, getFileExtension, legacyLargeFileFingerprint, safeDisplayFileName, usesContentIdForLargeFile } from '../utils/documentId';
import { PICKER_MIME_TYPES, resolveBookType } from './bookTypes';

function getDocumentsDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error('La carpeta local de documentos no esta disponible en este dispositivo.');
  }
  return `${FileSystem.documentDirectory}documents`;
}

async function ensureDocumentsDirectory() {
  const documentsDirectory = getDocumentsDirectory();
  const info = await FileSystem.getInfoAsync(documentsDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(documentsDirectory, { intermediates: true });
  }
}

/** ¿El archivo sigue ahí? Un content:// que falla se toma como que no está. */
async function fileStillExists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

async function copyAssetToDocuments(asset: DocumentPicker.DocumentPickerAsset): Promise<{
  documentId: string;
  documentName: string;
  destinationUri: string;
  /** El libro ya estaba en la biblioteca con su archivo en su lugar: se abre ese. */
  existing?: Book;
}> {
  const sourceInfo = await FileSystem.getInfoAsync(asset.uri);
  if (!sourceInfo.exists) {
    throw new Error('El archivo elegido no quedo disponible para lectura local.');
  }
  await ensureDocumentsDirectory();
  const documentName = safeDisplayFileName(asset.name);
  // Identidad por contenido (no por nombre/fecha): re-importar el mismo
  // archivo — aunque esté renombrado — matchea el mismo libro y conserva
  // progreso, capítulos, contexto y cache de audio.
  // fallbackKey ESTABLE (nombre+tamaño): para archivos >8MB el fingerprint no
  // lee el contenido y sin esto usaba asset.uri (ruta de caché efímera del
  // picker, cambia en cada importación) → id no determinista, 404 en modo
  // visual y progreso perdido. Coincide con lo que se manda al server.
  let documentId = await createBookFingerprint(asset.uri, asset.size, `${documentName}:${asset.size ?? 0}`);
  // Un archivo grande importado por una versión anterior tiene el id viejo
  // (nombre+tamaño): se conserva, que es el que tiene el progreso y las notas.
  if (usesContentIdForLargeFile(asset.size) && !(await bookRepository.getBookById(documentId))) {
    const legacyId = await legacyLargeFileFingerprint(documentName, asset.size as number);
    if (await bookRepository.getBookById(legacyId)) documentId = legacyId;
  }
  // Si ese libro YA está en la biblioteca y su archivo sigue ahí (entró por una
  // carpeta escaneada, o se importó antes), no se copia de nuevo: se abre el
  // que está. Antes se duplicaba el archivo dentro de la app (un cómic pesa
  // cientos de MB) y el libro se caía de su carpeta.
  const existing = await bookRepository.getBookById(documentId);
  if (existing && (await fileStillExists(existing.uri))) {
    await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
    return { documentId, documentName: existing.name, destinationUri: existing.uri, existing };
  }
  const extension = getFileExtension(documentName, asset.mimeType);
  const documentsDirectory = getDocumentsDirectory();
  const destinationUri = `${documentsDirectory}/${documentId}${extension}`;
  await FileSystem.deleteAsync(destinationUri, { idempotent: true });
  // El selector ya dejó una copia en el caché de la app: moverla es instantáneo;
  // copiarla de nuevo duplicaba el archivo (un cómic pesa cientos de MB).
  try {
    await FileSystem.moveAsync({ from: asset.uri, to: destinationUri });
  } catch {
    await FileSystem.copyAsync({ from: asset.uri, to: destinationUri });
  }
  const destinationInfo = await FileSystem.getInfoAsync(destinationUri);
  if (!destinationInfo.exists) {
    throw new Error('No se pudo guardar una copia local del archivo dentro de la app.');
  }
  return { documentId, documentName, destinationUri };
}

export const filePickerService = {
  async pickDocument(): Promise<Book | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...PICKER_MIME_TYPES],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const bookType = resolveBookType(asset.mimeType, safeDisplayFileName(asset.name));
    if (!bookType) {
      await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
      throw new Error('Formato no soportado. Bardo abre PDF, EPUB, TXT, DOCX y cómics (CBZ, CBR, CB7, CBT).');
    }
    const { documentId, documentName, destinationUri, existing } = await copyAssetToDocuments(asset);
    if (existing) return existing;

    const now = new Date().toISOString();
    const book: Book = {
      id: documentId,
      name: documentName,
      title: null,
      author: null,
      coverUri: null,
      summary: null,
      uri: destinationUri,
      type: bookType,
      importedAt: now,
      lastOpenedAt: now,
      ...NEW_BOOK_DEFAULTS,
    };

    return book;
  },

  async deleteStoredDocument(uri: string): Promise<void> {
    // Solo se borran copias internas de la app. Los libros descubiertos
    // por escaneo (content://) son archivos DEL USUARIO: jamás se tocan.
    if (!FileSystem.documentDirectory || !uri.startsWith(FileSystem.documentDirectory)) {
      return;
    }
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};
