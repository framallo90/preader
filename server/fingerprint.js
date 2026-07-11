/**
 * Huella de contenido del libro — RÉPLICA EXACTA de src/utils/documentId.ts
 * del cliente, para que el server y la app calculen el MISMO bk_… ante el
 * mismo archivo (así progreso, capítulos y cachés se alinean).
 *
 * Cliente: sha256( base64(primeros 256KB) + ":" + size ) → "bk_" + hex[0..24)
 * Para archivos > 8MB el cliente no lee contenido y usa el fallback
 * `fallback:${name}:${size}:${size}`.
 */
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;
const MAX_FINGERPRINT_READ_BYTES = 8 * 1024 * 1024;

export async function createBookFingerprint(filePath, originalName) {
  const { size } = await stat(filePath);

  let identity;
  if (size > 0 && size <= MAX_FINGERPRINT_READ_BYTES) {
    const fh = await open(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(FINGERPRINT_SAMPLE_BYTES, size));
      await fh.read(buf, 0, buf.length, 0);
      identity = `${buf.toString('base64')}:${size}`;
    } finally {
      await fh.close();
    }
  } else {
    identity = `fallback:${originalName}:${size}:${size}`;
  }

  const digest = createHash('sha256').update(identity, 'utf8').digest('hex');
  return `bk_${digest.slice(0, 24)}`;
}
