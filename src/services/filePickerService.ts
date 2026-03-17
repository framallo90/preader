import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { StoredDocument } from '../types/storage';
import { createDocumentId, getFileExtension, safeDisplayFileName } from '../utils/documentId';

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

export const filePickerService = {
  async pickPdfDocument(): Promise<StoredDocument | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
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
    await FileSystem.copyAsync({
      from: asset.uri,
      to: destinationUri,
    });

    const destinationInfo = await FileSystem.getInfoAsync(destinationUri);

    if (!destinationInfo.exists) {
      throw new Error('No se pudo guardar una copia local del PDF dentro de la app.');
    }

    const now = new Date().toISOString();

    return {
      id: documentId,
      name: documentName,
      uri: destinationUri,
      type: asset.mimeType ?? 'application/pdf',
      importedAt: now,
      lastOpenedAt: now,
    };
  },

  async deleteStoredDocument(uri: string) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};
