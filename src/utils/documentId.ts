import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

/** Cuántos bytes del inicio del archivo participan de la huella. */
const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;

/**
 * Huella de contenido del libro (estilo ReadEra): hash de los primeros
 * 256 KB del archivo + su tamaño. Es estable ante renombres, movidas y
 * re-descargas, así que el progreso, los capítulos, el contexto y el
 * cache de TTS sobreviven aunque el archivo cambie de nombre o de lugar.
 */
export async function createBookFingerprint(uri: string, size?: number | null): Promise<string> {
  const sample = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: FINGERPRINT_SAMPLE_BYTES,
  });

  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${sample}:${size ?? 0}`,
  );

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
