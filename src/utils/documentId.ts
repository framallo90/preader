import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';

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

  // Sin tamaño, la huella caía en `nombre:0`: DOS archivos distintos con el
  // mismo nombre ("libro.pdf") daban el mismo id, y al importar el segundo se
  // pisaba la copia del primero (se perdía con su progreso). Varios proveedores
  // SAF/nube no informan el tamaño en el listado, pero sí al preguntarles.
  let knownSize = size;
  if (knownSize == null) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof info.size === 'number' && info.size > 0) knownSize = info.size;
    } catch {
      // Sigue sin tamaño: se usa el nombre, que es lo único que hay.
    }
  }

  // Solo leemos contenido de archivos razonablemente chicos. Si el archivo es
  // grande (o de tamaño desconocido), NO leemos nada y usamos huella por
  // nombre+tamaño: evita el OOM que cerraba la app al escanear carpetas con
  // libros enormes. La lectura parcial no es confiable en content:// de SAF.
  // El módulo nativo lee exactamente 256 KB por stream, sin cargar el archivo:
  // con él, la huella de contenido vale también para los archivos grandes (un
  // libro de 20 MB renombrado seguía siendo el mismo libro; antes se duplicaba
  // y la copia vieja quedaba muerta). El tope de 8 MB queda para el camino en
  // JavaScript, que sí puede leer el archivo entero.
  const canReadContent =
    knownSize != null && knownSize > 0 && (knownSize <= MAX_FINGERPRINT_READ_BYTES || isBardoArchiveAvailable());

  // Nativo: lee exactamente 256 KB y hashea ahí, sin pasar base64 por el puente.
  // Misma fórmula que abajo, así el id de un libro no cambia.
  if (canReadContent && isBardoArchiveAvailable()) {
    try {
      return await getBardoArchiveModule().fingerprintAsync(uri, knownSize as number);
    } catch {
      // se cae a la versión en JavaScript
    }
  }

  if (canReadContent && (knownSize as number) <= MAX_FINGERPRINT_READ_BYTES) {
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

  const identity = sample ? `${sample}:${knownSize ?? 0}` : `fallback:${fallbackKey ?? uri}:${knownSize ?? 0}`;

  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity);

  return `bk_${digest.slice(0, 24)}`;
}

/** ¿Este archivo es de los que ANTES se identificaban por nombre+tamaño y ahora por contenido? */
export function usesContentIdForLargeFile(size?: number | null): boolean {
  return size != null && size > MAX_FINGERPRINT_READ_BYTES && isBardoArchiveAvailable();
}

/**
 * El id que una versión anterior le daba a un archivo grande (sin leer su
 * contenido): sirve para reconocer los libros ya guardados con ese id.
 */
export async function legacyLargeFileFingerprint(name: string, size: number): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `fallback:${name}:${size}:${size}`);
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
