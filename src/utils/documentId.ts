import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

/** Cuántos bytes del inicio del archivo participan de la huella. */
const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;

/**
 * No leemos el contenido de archivos más grandes que esto para la huella.
 * En content:// de SAF la lectura parcial (length) suele ignorarse y se lee el
 * archivo ENTERO en memoria; un PDF grande haría OOM y cerraría la app durante
 * el escaneo de la carpeta. Los archivos grandes usan huella por nombre+tamaño.
 */
const MAX_FINGERPRINT_READ_BYTES = 8 * 1024 * 1024;

/**
 * Huella de contenido del libro (estilo ReadEra): hash de los primeros
 * 256 KB del archivo + su tamaño. Es estable ante renombres, movidas y
 * re-descargas, así que el progreso, los capítulos, el contexto y el
 * cache de TTS sobreviven aunque el archivo cambie de nombre o de lugar.
 */
export async function createBookFingerprint(
  uri: string,
  size?: number | null,
  fallbackKey?: string,
): Promise<string> {
  let sample = '';

  // Solo leemos contenido de archivos razonablemente chicos. Si el archivo es
  // grande (o de tamaño desconocido), NO leemos nada y usamos huella por
  // nombre+tamaño: evita el OOM que cerraba la app al escanear carpetas con
  // libros enormes. La lectura parcial no es confiable en content:// de SAF.
  const canReadContent = size != null && size > 0 && size <= MAX_FINGERPRINT_READ_BYTES;

  if (canReadContent) {
    try {
      sample = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: FINGERPRINT_SAMPLE_BYTES,
      });
      // Si SAF ignoró el length y leyó de más, recortamos para no hashear todo.
      const maxBase64 = Math.ceil((FINGERPRINT_SAMPLE_BYTES * 4) / 3) + 4;
      if (sample.length > maxBase64) {
        sample = sample.slice(0, maxBase64);
      }
    } catch {
      sample = '';
    }
  }

  const identity = sample ? `${sample}:${size ?? 0}` : `fallback:${fallbackKey ?? uri}:${size ?? 0}`;

  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity);

  return `bk_${digest.slice(0, 24)}`;
}

export function safeDisplayFileName(name: string) {
  const cleanName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_');
  return cleanName || 'documento.pdf';
}

export function getFileExtension(name: string, mimeType?: string | null) {
  if (name.includes('.')) {
    return `.${name.split('.').pop() ?? 'pdf'}`.toLowerCase();
  }

  if (mimeType === 'application/pdf') {
    return '.pdf';
  }

  return '.bin';
}
