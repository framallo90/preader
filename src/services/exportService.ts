import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { dayKey } from '../utils/readingStats';

const { StorageAccessFramework } = FileSystem;

/**
 * Guardar un archivo donde vos quieras, con el selector del sistema.
 *
 * Se usa SAF y no una carpeta propia de la app porque lo exportado tiene que
 * sobrevivir a desinstalar Bardo, y porque en el selector de Android aparecen
 * también Drive y los demás destinos que tengas: eso da "mandarlo a la nube"
 * sin que la app hable con ninguna nube ni pida permisos de red.
 */
export async function saveTextFile(
  suggestedName: string,
  mimeType: string,
  content: string,
): Promise<'saved' | 'cancelled'> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return 'cancelled';
  const uri = await StorageAccessFramework.createFileAsync(permission.directoryUri, suggestedName, mimeType);
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  return 'saved';
}

/** Nombre de archivo sin caracteres que rompan en Android ni en Windows. */
export function safeFileName(base: string, extension: string): string {
  const limpio = base
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  // Fecha LOCAL: con toISOString, exportar de noche en Argentina ponía la de mañana.
  const fecha = dayKey(new Date());
  return `${limpio.length > 0 ? limpio : 'bardo'} ${fecha}.${extension}`;
}

/**
 * Deja elegir un archivo y devuelve su contenido como texto.
 *
 * Se usa el selector de documentos (no el de carpetas) porque acá se elige UN
 * archivo puntual: el respaldo a restaurar.
 */
export async function readPickedTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/*', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  return FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
}
