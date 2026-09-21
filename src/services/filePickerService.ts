import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Book, NEW_BOOK_DEFAULTS, StoredDocument } from '../types/storage';
import { createBookFingerprint, getFileExtension, safeDisplayFileName } from '../utils/documentId';
import { SUPPORTED_MIME_TYPES } from './parserRegistry';

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

async function copyAssetToDocuments(asset: DocumentPicker.DocumentPickerAsset): Promise<{
  documentId: string;
  documentName: string;
  destinationUri: string;
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
  const documentId = await createBookFingerprint(asset.uri, asset.size, `${documentName}:${asset.size ?? 0}`);
  const extension = getFileExtension(documentName, asset.mimeType);
  const documentsDirectory = getDocumentsDirectory();
  const destinationUri = `${documentsDirectory}/${documentId}${extension}`;
  await FileSystem.deleteAsync(destinationUri, { idempotent: true });
  await FileSystem.copyAsync({ from: asset.uri, to: destinationUri });
  const destinationInfo = await FileSystem.getInfoAsync(destinationUri);
  if (!destinationInfo.exists) {
    throw new Error('No se pudo guardar una copia local del archivo dentro de la app.');
  }
  return { documentId, documentName, destinationUri };
}

export const filePickerService = {
  async pickDocument(sagaId?: string, orderIndex = 0): Promise<Book | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...SUPPORTED_MIME_TYPES],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const { documentId, documentName, destinationUri } = await copyAssetToDocuments(asset);

    const now = new Date().toISOString();
    const book: Book = {
      id: documentId,
      sagaId: sagaId ?? null,
      name: documentName,
      title: null,
      author: null,
      coverUri: null,
      orderIndex,
      uri: destinationUri,
      type: asset.mimeType ?? 'application/pdf',
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
