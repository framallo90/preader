/**
 * openaiTtsService.ts
 *
 * Sintetiza audio MP3 a través de la Edge Function de Supabase.
 * La API key de OpenAI NUNCA está en el APK — vive en los secrets de la función.
 * La función verifica premium antes de hacer el proxy.
 * El audio resultante se cachea localmente para no repetir llamadas.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '../config/supabase';

export type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export type TtsModel = 'tts-1' | 'tts-1-hd';

export const DEFAULT_VOICE: TtsVoice = 'onyx';
export const DEFAULT_MODEL: TtsModel = 'tts-1-hd';

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

function getCachedFilePath(chunkId: string, voice: TtsVoice, model: TtsModel): string {
  return `${getTtsCacheDirectory()}/${chunkId}--${voice}--${model}.mp3`;
}

/**
 * Genera audio MP3 para un texto dado vía Supabase Edge Function.
 * Si ya existe en caché local, devuelve la URI sin llamar a la API.
 */
export async function synthesizeSpeech(
  chunkId: string,
  text: string,
  voice: TtsVoice = DEFAULT_VOICE,
  model: TtsModel = DEFAULT_MODEL,
): Promise<string> {
  await ensureTtsCacheDirectory();

  const cachedPath = getCachedFilePath(chunkId, voice, model);
  const cached = await FileSystem.getInfoAsync(cachedPath);
  if (cached.exists) return cachedPath;

  const { data, error } = await supabase.functions.invoke('tts', {
    body: { text, voice, model },
  });

  if (error) throw new Error(`TTS proxy error: ${error.message}`);

  const response = data as { audio?: string; error?: string };
  if (response.error) throw new Error(`TTS API error: ${response.error}`);
  if (!response.audio) throw new Error('La función TTS no devolvió audio');

  await FileSystem.writeAsStringAsync(cachedPath, response.audio, {
    encoding: FileSystem.EncodingType.Base64,
  });

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

/**
 * Estima el costo aproximado en USD de sintetizar un texto.
 * tts-1-hd: $0.030 por 1000 caracteres
 * tts-1:    $0.015 por 1000 caracteres
 */
export function estimateTtsCost(text: string, model: TtsModel = DEFAULT_MODEL): number {
  const ratePerChar = model === 'tts-1-hd' ? 0.00003 : 0.000015;
  return text.length * ratePerChar;
}
