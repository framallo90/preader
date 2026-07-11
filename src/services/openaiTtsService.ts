/**
 * openaiTtsService.ts
 *
 * En modo uso propio el TTS lo genera Kokoro (español) vía fal.ai, llamado
 * directo desde la app con la FAL_KEY de apiKeys.ts (gitignoreado). fal devuelve
 * una URL a un WAV que se descarga y se cachea localmente para no repetir la
 * llamada (ni el gasto).
 *
 * El nombre del archivo y los exports se mantienen por compatibilidad con
 * documentAudioPlaybackService.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { FAL_KEY } from '../config/apiKeys';

// Tipos heredados (los usa el playback service y el selector de voz de Ajustes).
export type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export type TtsModel = 'tts-1' | 'tts-1-hd';

export const DEFAULT_VOICE: TtsVoice = 'onyx';
export const DEFAULT_MODEL: TtsModel = 'tts-1-hd';

// ── Kokoro (español) en fal.ai ────────────────────────────────────────────────
const FAL_TTS_URL = 'https://fal.run/fal-ai/kokoro/spanish';
type KokoroVoice = 'ef_dora' | 'em_alex' | 'em_santa';
const DEFAULT_KOKORO_VOICE: KokoroVoice = 'em_alex';

/** Mapea la voz elegida en Ajustes (nombres OpenAI) a una voz española de Kokoro. */
function toKokoroVoice(voice: TtsVoice): KokoroVoice {
  if (voice === 'nova' || voice === 'shimmer') return 'ef_dora'; // femeninas
  if (voice === 'alloy') return 'em_santa';
  return DEFAULT_KOKORO_VOICE; // onyx, echo, fable → em_alex
}

function getTtsCacheDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('Directorio de documentos no disponible.');
  }
  return `${FileSystem.documentDirectory}tts-cache`;
}

async function ensureTtsCacheDirectory(): Promise<void> {
  const dir = getTtsCacheDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

function getCachedFilePath(chunkId: string, voice: KokoroVoice): string {
  return `${getTtsCacheDirectory()}/${chunkId}--${voice}--kokoro.wav`;
}

// fal/Kokoro solo entrega WAV (sin comprimir, ~48 KB/s), así que un libro entero
// serían GB. Acotamos el caché: al pasar el tope se borran los archivos más
// viejos (los tramos ya escuchados) hasta volver por debajo. El audio se
// regenera si alguna vez se vuelve atrás.
const MAX_CACHE_BYTES = 400 * 1024 * 1024; // ~400 MB

async function enforceCacheLimit(): Promise<void> {
  try {
    const dir = getTtsCacheDirectory();
    const files = await FileSystem.readDirectoryAsync(dir);
    const infos = await Promise.all(
      files.map(async (f) => {
        const info = await FileSystem.getInfoAsync(`${dir}/${f}`);
        return {
          path: `${dir}/${f}`,
          size: info.exists ? info.size ?? 0 : 0,
          mtime: info.exists ? info.modificationTime ?? 0 : 0,
        };
      }),
    );

    let total = infos.reduce((sum, i) => sum + i.size, 0);
    if (total <= MAX_CACHE_BYTES) return;

    // Más viejo primero. El archivo recién escrito es el más nuevo → no se borra.
    infos.sort((a, b) => a.mtime - b.mtime);
    for (const info of infos) {
      if (total <= MAX_CACHE_BYTES) break;
      await FileSystem.deleteAsync(info.path, { idempotent: true }).catch(() => {});
      total -= info.size;
    }
  } catch {
    // La limpieza de caché nunca debe romper la reproducción.
  }
}

/**
 * Genera audio para un texto vía fal.ai (Kokoro español).
 * Si ya existe en caché local, devuelve la URI sin llamar a la API.
 * La firma se mantiene (chunkId, text, voice, model) por compatibilidad; el
 * parámetro de modelo ya no aplica a Kokoro.
 */
export async function synthesizeSpeech(
  chunkId: string,
  text: string,
  voice: TtsVoice = DEFAULT_VOICE,
  _model: TtsModel = DEFAULT_MODEL,
): Promise<string> {
  await ensureTtsCacheDirectory();

  const kokoroVoice = toKokoroVoice(voice);
  const cachedPath = getCachedFilePath(chunkId, kokoroVoice);
  const cached = await FileSystem.getInfoAsync(cachedPath);
  if (cached.exists) return cachedPath;

  if (!FAL_KEY) {
    throw new Error('Falta FAL_KEY en src/config/apiKeys.ts para generar la voz.');
  }

  const response = await fetch(FAL_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: text, voice: kokoroVoice, speed: 1 }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`TTS fal error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { audio?: { url?: string }; error?: unknown };
  const audioUrl = data.audio?.url;
  if (!audioUrl) throw new Error('fal no devolvió URL de audio.');

  const download = await FileSystem.downloadAsync(audioUrl, cachedPath);
  if (download.status !== 200) {
    await FileSystem.deleteAsync(cachedPath, { idempotent: true }).catch(() => {});
    throw new Error(`No se pudo descargar el audio (HTTP ${download.status}).`);
  }

  await enforceCacheLimit();

  return cachedPath;
}

/**
 * Elimina todo el audio cacheado de un libro.
 */
export async function clearBookAudio(bookId: string): Promise<void> {
  const dir = getTtsCacheDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return;

  const files = await FileSystem.readDirectoryAsync(dir);
  const bookFiles = files.filter((f) => f.startsWith(bookId));

  await Promise.all(
    bookFiles.map((f) => FileSystem.deleteAsync(`${dir}/${f}`, { idempotent: true })),
  );
}

/** Borra TODO el audio cacheado (todos los libros). */
export async function clearAllAudio(): Promise<void> {
  const dir = getTtsCacheDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return;
  try {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    // best-effort
  }
}

/**
 * Estima el costo aproximado en USD de sintetizar un texto.
 * Kokoro en fal.ai se cobra por caracteres/segundos; este número es orientativo.
 */
export function estimateTtsCost(text: string): number {
  // Aproximación conservadora para mostrar en UI; ajustar con el pricing real de fal.
  return text.length * 0.00001;
}
