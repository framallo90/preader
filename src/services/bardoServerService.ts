/**
 * bardoServerService.ts
 *
 * Cliente del backend propio (bardo-api): sube el libro al server, espera a que
 * el pipeline lo procese (PyMuPDF + limpieza) y baja el texto limpio. La app
 * abre así cualquier libro sin extraer nada en el teléfono — incluso los
 * gigantes que localmente harían OOM. Si el server no responde, el caller cae
 * al parser local (fallback transparente).
 */

import * as FileSystem from 'expo-file-system/legacy';

import { BARDO_SERVER_URL, BARDO_TOKEN } from '../config/apiKeys';
import { bookRepository } from '../storage/bookRepository';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // libros grandes pueden tardar minutos
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type ServerBookResult = {
  fullText: string;
  title: string | null;
};

type ServerStatus = {
  id: string;
  status: 'queued' | 'extracting' | 'cleaning' | 'ready' | 'error';
  error?: string | null;
  title?: string | null;
  hasCover?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'En cola en el servidor…',
  extracting: 'Extrayendo el texto en el servidor…',
  cleaning: 'Limpiando el texto…',
};

export function isServerConfigured(): boolean {
  return Boolean(BARDO_SERVER_URL && BARDO_TOKEN);
}

export type ServerBookInfo = {
  pages: number;
  pageAspect: number | null;
  /** Dónde empieza cada página dentro de fullText (mapeo exacto voz↔página). */
  pageOffsets: number[] | null;
};

/** Info del libro ya procesado (páginas + aspecto) para el modo lectura visual. */
export async function getBookInfo(bookId: string): Promise<ServerBookInfo | null> {
  if (!isServerConfigured()) return null;
  try {
    const response = await fetchWithTimeout(`${BARDO_SERVER_URL}/books/${bookId}`, { headers: authHeaders() }, 10_000);
    if (!response.ok) return null;
    const status = (await response.json()) as ServerStatus & {
      pages?: number;
      pageAspect?: number | null;
      pageOffsets?: number[] | null;
    };
    if (status.status !== 'ready' || !status.pages) return null;
    return {
      pages: status.pages,
      pageAspect: status.pageAspect ?? null,
      pageOffsets: Array.isArray(status.pageOffsets) ? status.pageOffsets : null,
    };
  } catch {
    return null;
  }
}

/** Fuente (uri + headers) de una página renderizada al ancho pedido. */
export function getPageImageSource(bookId: string, pageIndex: number, widthPx: number) {
  return {
    uri: `${BARDO_SERVER_URL}/books/${bookId}/page/${pageIndex}?w=${Math.round(widthPx)}`,
    headers: authHeaders(),
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${BARDO_TOKEN}` };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Procesa un libro en el server y devuelve el texto limpio.
 * Lanza si el server no está disponible o el pipeline falla — el caller decide
 * el fallback local.
 */
/**
 * Baja la portada generada por el server a covers/{localBookId}.png y actualiza
 * el libro (título + coverUri). Silencioso: una portada que falla no debe
 * frenar la apertura.
 */
async function saveCoverAndTitle(
  serverBookId: string,
  localBookId: string,
  title: string | null,
  hasCover: boolean,
): Promise<void> {
  try {
    let coverUri: string | null = null;
    if (hasCover && FileSystem.documentDirectory) {
      const dir = `${FileSystem.documentDirectory}covers`;
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${localBookId}.png`;
      const download = await FileSystem.downloadAsync(`${BARDO_SERVER_URL}/books/${serverBookId}/cover`, dest, {
        headers: authHeaders(),
      });
      if (download.status === 200) coverUri = dest;
    }
    if (title || coverUri) {
      await bookRepository.updateBookMetadata(localBookId, { title, author: null, coverUri });
    }
  } catch {
    // sin portada no pasa nada
  }
}

export async function processBookOnServer(
  fileUri: string,
  fileName: string,
  mimeType: string | null,
  localBookId: string,
  onStatus?: (label: string) => void,
): Promise<ServerBookResult> {
  onStatus?.('Subiendo el libro al servidor…');

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType ?? 'application/octet-stream',
  } as unknown as Blob);

  const uploadResponse = await fetchWithTimeout(
    `${BARDO_SERVER_URL}/books`,
    { method: 'POST', headers: authHeaders(), body: formData },
    UPLOAD_TIMEOUT_MS,
  );
  if (!uploadResponse.ok) {
    throw new Error(`El servidor rechazó la subida (HTTP ${uploadResponse.status}).`);
  }
  const uploaded = (await uploadResponse.json()) as { id: string; status: string };

  // Poll hasta que el pipeline termine.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status: ServerStatus = { id: uploaded.id, status: uploaded.status as ServerStatus['status'] };

  while (status.status !== 'ready') {
    if (status.status === 'error') {
      throw new Error(status.error ?? 'El servidor no pudo procesar el libro.');
    }
    if (Date.now() > deadline) {
      throw new Error('El servidor tardó demasiado en procesar el libro.');
    }
    onStatus?.(STATUS_LABELS[status.status] ?? 'Procesando en el servidor…');
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetchWithTimeout(
      `${BARDO_SERVER_URL}/books/${uploaded.id}`,
      { headers: authHeaders() },
      15_000,
    );
    if (!statusResponse.ok) {
      throw new Error(`No se pudo consultar el estado (HTTP ${statusResponse.status}).`);
    }
    status = (await statusResponse.json()) as ServerStatus;
  }

  // Portada + título en paralelo con la bajada del texto.
  void saveCoverAndTitle(uploaded.id, localBookId, status.title ?? null, Boolean(status.hasCover));

  onStatus?.('Descargando el texto…');
  const textResponse = await fetchWithTimeout(
    `${BARDO_SERVER_URL}/books/${uploaded.id}/fulltext`,
    { headers: authHeaders() },
    120_000,
  );
  if (!textResponse.ok) {
    throw new Error(`No se pudo descargar el texto (HTTP ${textResponse.status}).`);
  }
  const fullText = await textResponse.text();
  if (!fullText.trim()) {
    throw new Error('El servidor devolvió un texto vacío.');
  }

  return { fullText, title: status.title ?? null };
}
