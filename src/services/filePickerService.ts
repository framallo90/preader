import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Book, StoredDocument } from '../types/storage';
import { createDocumentId, getFileExtension, safeDisplayFileName } from '../utils/documentId';
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
  const documentId = createDocumentId({
    name: documentName,
    lastModified: asset.lastModified,
    size: asset.size,
  });
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
      orderIndex,
      uri: destinationUri,
      type: asset.mimeType ?? 'application/pdf',
      importedAt: now,
      lastOpenedAt: now,
    };

    return book;
  },

  async deleteStoredDocument(uri: string): Promise<void> {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};
