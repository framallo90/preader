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
export async function createBookFingerprint(
  uri: string,
  size?: number | null,
  fallbackKey?: string,
): Promise<string> {
  let sample = '';

  try {
    sample = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: FINGERPRINT_SAMPLE_BYTES,
    });
  } catch {
    // Algunos content:// de SAF no soportan lectura parcial.
    // Para archivos chicos leemos todo; para grandes usamos el fallback.
    if (size != null && size > 0 && size <= 8 * 1024 * 1024) {
      try {
        const whole = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        sample = whole.slice(0, Math.ceil((FINGERPRINT_SAMPLE_BYTES * 4) / 3));
      } catch {
        sample = '';
      }
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
