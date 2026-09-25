/**
 * systemTtsService.ts
 *
 * Genera el audio con el motor TTS del sistema (offline, gratis, sin claves),
 * escribiéndolo a un WAV. El reproductor (documentAudioPlaybackService) sigue
 * trabajando con archivos, así que background, pantalla bloqueada, seek y
 * retroceso funcionan igual que antes.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { NativeVoice, getVoiceSynthesizerModule, isVoiceSynthesizerAvailable } from '../../modules/voice-synthesizer';

export type SystemVoice = NativeVoice;

// Regenerar es gratis y rápido: el caché solo evita re-sintetizar al retroceder.
// Por eso vive en cacheDirectory (el sistema puede purgarlo) y es chico.
const MAX_CACHE_BYTES = 120 * 1024 * 1024;
const SYNTHESIS_TIMEOUT_MS = 90_000;
// Consultar las voces al motor cuesta cientos de ms en el teléfono y se hace
// antes de cada play: se recuerdan un buen rato (Ajustes las refresca a mano).
const VOICES_TTL_MS = 15 * 60_000;

let voicesCache: { at: number; voices: SystemVoice[] } | null = null;
let legacyCacheCleaned = false;
// La poda del caché lista TODOS los archivos (una llamada por archivo): no se hace
// en cada tramo sintetizado, sino cada tantos.
let synthesizedSinceEviction = 0;
const EVICTION_EVERY_CHUNKS = 25;

function getCacheDirectory(): string {
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) throw new Error('Directorio de caché no disponible.');
  return `${base}tts-cache`;
}

async function ensureCacheDirectory(): Promise<string> {
  const dir = getCacheDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** El caché viejo (WAVs de la voz en la nube, hasta 400 MB) vivía en documentDirectory. */
async function cleanLegacyCacheOnce(): Promise<void> {
  if (legacyCacheCleaned) return;
  legacyCacheCleaned = true;
  if (!FileSystem.documentDirectory || !FileSystem.cacheDirectory) return;
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}tts-cache`, { idempotent: true }).catch(() => {});
}

async function enforceCacheLimit(dir: string): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(dir);
    const infos = await Promise.all(
      files.map(async (name) => {
        const info = await FileSystem.getInfoAsync(`${dir}/${name}`);
        return {
          path: `${dir}/${name}`,
          size: info.exists ? info.size ?? 0 : 0,
          mtime: info.exists ? info.modificationTime ?? 0 : 0,
        };
      }),
    );
    let total = infos.reduce((sum, item) => sum + item.size, 0);
    if (total <= MAX_CACHE_BYTES) return;

    // Más viejo primero: el archivo recién escrito es el más nuevo y no se borra.
    infos.sort((a, b) => a.mtime - b.mtime);
    for (const item of infos) {
      if (total <= MAX_CACHE_BYTES) break;
      await FileSystem.deleteAsync(item.path, { idempotent: true }).catch(() => {});
      total -= item.size;
    }
  } catch {
    // La limpieza de caché nunca debe romper la reproducción.
  }
}

function sanitizeForFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 180);
}

/** Voces que reporta el motor TTS del sistema (todas, sin filtrar). */
export async function listVoices(forceRefresh = false): Promise<SystemVoice[]> {
  if (!forceRefresh && voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS) {
    return voicesCache.voices;
  }
  // Sin módulo nativo (iOS, todavía) no hay voces: lista vacía, no un error.
  if (!isVoiceSynthesizerAvailable()) return [];
  // Con tope: en frío el motor de texto a voz puede tardar en arrancar, y el
  // play esperaba esto sin dar señales de vida.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('El motor de voz tardó demasiado en responder.')), 10000);
  });
  let voices: SystemVoice[];
  try {
    voices = await Promise.race([getVoiceSynthesizerModule().getVoicesAsync(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  voicesCache = { at: Date.now(), voices };
  return voices;
}

/**
 * Sintetiza un tramo a WAV. Si ya está en caché devuelve la ruta sin tocar el motor.
 * `chunkId` ya incluye la voz, así que cambiar de voz no reutiliza audio viejo.
 */
export async function synthesizeSpeech(
  chunkId: string,
  text: string,
  voiceId: string | null,
  language: string | null,
): Promise<string> {
  if (!isVoiceSynthesizerAvailable()) {
    throw new Error('La voz del sistema no está disponible en este dispositivo.');
  }
  void cleanLegacyCacheOnce();
  const dir = await ensureCacheDirectory();
  const filePath = `${dir}/${sanitizeForFileName(chunkId)}.wav`;

  const cached = await FileSystem.getInfoAsync(filePath);
  if (cached.exists && (cached.size ?? 0) > 44) return filePath;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('El motor de voz tardó demasiado en generar el audio.')), SYNTHESIS_TIMEOUT_MS);
  });

  // Si gana el timeout, la síntesis sigue viva y más tarde la cancelan: ese
  // rechazo ya no tiene a nadie esperándolo y salía como error sin atrapar.
  const synthesis = getVoiceSynthesizerModule().synthesizeToFileAsync(text, voiceId, language, filePath);
  synthesis.catch(() => {});

  try {
    const uri = await Promise.race([synthesis, timeout]);
    synthesizedSinceEviction += 1;
    if (synthesizedSinceEviction >= EVICTION_EVERY_CHUNKS) {
      synthesizedSinceEviction = 0;
      void enforceCacheLimit(dir);
    }
    return uri;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Descarta la síntesis en curso y la cola (nuevo play/seek lejos del tramo actual). */
export async function cancelPendingSynthesis(): Promise<void> {
  if (!isVoiceSynthesizerAvailable()) return;
  await getVoiceSynthesizerModule().cancelAllAsync().catch(() => {});
}

/** Borra el audio generado de un libro (al eliminarlo de la biblioteca). */
export async function clearBookAudio(bookId: string): Promise<void> {
  const dir = getCacheDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const prefix = sanitizeForFileName(bookId);
  const files = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    files
      .filter((name) => name.startsWith(prefix))
      .map((name) => FileSystem.deleteAsync(`${dir}/${name}`, { idempotent: true })),
  );
}

/** Borra todo el audio generado. */
export async function clearAllAudio(): Promise<void> {
  await FileSystem.deleteAsync(getCacheDirectory(), { idempotent: true }).catch(() => {});
  await cleanLegacyCacheOnce();
}
