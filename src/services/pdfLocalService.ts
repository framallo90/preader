/**
 * pdfLocalService.ts
 *
 * Todo el trabajo de PDF en el teléfono (módulo nativo bardo-pdf): páginas
 * renderizadas a demanda, texto por página, portada y recorte de márgenes.
 * Reemplaza al backend: abrir un libro ya no sube nada ni espera a la red.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { PdfColorMode, PdfCropBox, PdfExtraction, getBardoPdfModule, isBardoPdfAvailable } from '../../modules/bardo-pdf';

export type { PdfColorMode, PdfCropBox };

export type PdfPageRequest = {
  bookId: string;
  uri: string;
  pageIndex: number;
  widthPx: number;
  colorMode: PdfColorMode;
  crop: PdfCropBox | null;
};

// Las páginas se regeneran en milisegundos: el caché solo evita redibujar al
// volver atrás, así que vive en cacheDirectory y tiene tope.
const MAX_PAGE_CACHE_BYTES = 250 * 1024 * 1024;
const COVER_WIDTH_PX = 600;

let renderedSinceEviction = 0;

export function isLocalPdfAvailable(): boolean {
  return isBardoPdfAvailable();
}

function getPagesRoot(): string {
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) throw new Error('Directorio de caché no disponible.');
  return `${base}pdf-pages`;
}

function bookPagesDirectory(bookId: string): string {
  return `${getPagesRoot()}/${encodeURIComponent(bookId)}`;
}

async function ensureDirectory(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

function cropKey(crop: PdfCropBox | null): string {
  return crop ? crop.map((v) => Math.round(v * 1000)).join('_') : 'full';
}

/** Número de páginas y proporción de la primera (para calcular el alto al vuelo). */
export async function getPdfInfo(uri: string) {
  return getBardoPdfModule().getInfoAsync(uri);
}

// ── Cola de render ──────────────────────────────────────────────────────────
// El módulo nativo dibuja de a una página. Si el usuario pasa 200 páginas de un
// tirón, una cola FIFO dibujaría todas las que ya salieron de pantalla antes de
// llegar a la que está mirando. Por eso: LIFO (lo último pedido es lo visible) y
// los pedidos de páginas que ya se desmontaron se descartan sin dibujarse.

type RenderJob = {
  key: string;
  request: PdfPageRequest;
  filePath: string;
  subscribers: number;
  started: boolean;
  promise: Promise<string>;
  resolve: (uri: string) => void;
  reject: (error: unknown) => void;
};

export type PdfPageTicket = {
  promise: Promise<string>;
  /** Llamar al desmontar: si nadie más espera esta página y aún no empezó, no se dibuja. */
  cancel: () => void;
};

export const PDF_RENDER_CANCELLED = 'pdf_render_cancelled';

const jobs = new Map<string, RenderJob>();
const pending: RenderJob[] = [];
let isRendering = false;

function pumpRenderQueue() {
  if (isRendering) return;
  let job: RenderJob | undefined;
  while ((job = pending.pop())) {
    if (job.subscribers > 0) break;
    jobs.delete(job.key);
    job.reject(new Error(PDF_RENDER_CANCELLED));
    job = undefined;
  }
  if (!job) return;

  const active = job;
  active.started = true;
  isRendering = true;
  const { uri, pageIndex, widthPx, colorMode, crop, bookId } = active.request;

  ensureDirectory(bookPagesDirectory(bookId))
    .then(() =>
      getBardoPdfModule().renderPageAsync(
        uri,
        pageIndex,
        Math.round(widthPx),
        colorMode === 'day' ? null : colorMode,
        crop,
        active.filePath,
      ),
    )
    .then(active.resolve, active.reject)
    .finally(() => {
      jobs.delete(active.key);
      isRendering = false;
      renderedSinceEviction += 1;
      if (renderedSinceEviction >= 40) {
        renderedSinceEviction = 0;
        void enforcePageCacheLimit();
      }
      pumpRenderQueue();
    });
}

/**
 * Pide una página dibujada. Si ya está en disco se resuelve sin pasar por la
 * cola; si no, se encola. Varios pedidos de la misma página comparten trabajo.
 */
export function requestPdfPage(request: PdfPageRequest): PdfPageTicket {
  const { bookId, pageIndex, widthPx, colorMode, crop } = request;
  const fileName = `${pageIndex}-${Math.round(widthPx)}-${colorMode}-${cropKey(crop)}.jpg`;
  const key = `${bookId}/${fileName}`;
  const filePath = `${bookPagesDirectory(bookId)}/${fileName}`;

  let cancelled = false;
  let queuedJob: RenderJob | null = null;

  const promise = (async () => {
    const cached = await FileSystem.getInfoAsync(filePath);
    if (cached.exists && (cached.size ?? 0) > 0) return filePath;
    if (cancelled) throw new Error(PDF_RENDER_CANCELLED);

    let job = jobs.get(key);
    if (!job) {
      let resolve!: (uri: string) => void;
      let reject!: (error: unknown) => void;
      const jobPromise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Si todos los que esperaban se fueron, el rechazo no debe quedar sin atender.
      jobPromise.catch(() => {});
      job = { key, request, filePath, subscribers: 0, started: false, promise: jobPromise, resolve, reject };
      jobs.set(key, job);
      pending.push(job);
    } else if (!job.started) {
      // Pedido otra vez: vuelve al tope de la pila (es lo que está en pantalla).
      const index = pending.indexOf(job);
      if (index >= 0) {
        pending.splice(index, 1);
        pending.push(job);
      }
    }
    job.subscribers += 1;
    queuedJob = job;
    pumpRenderQueue();
    return job.promise;
  })();

  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      if (queuedJob) queuedJob.subscribers = Math.max(0, queuedJob.subscribers - 1);
    },
  };
}

/** Texto por página (una entrada por página) + título y autor del PDF. */
export async function extractPdfPages(
  uri: string,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfExtraction> {
  const module = getBardoPdfModule();
  const subscription = onProgress
    ? module.addListener('extractProgress', (event) => {
        if (event.uri === uri) onProgress(event.done, event.total);
      })
    : null;
  try {
    return await module.extractPagesAsync(uri);
  } finally {
    subscription?.remove();
  }
}

/** Caja de contenido común al libro, o null si no hay margen que valga recortar. */
export async function detectPdfCrop(uri: string): Promise<PdfCropBox | null> {
  const box = await getBardoPdfModule().detectContentBoxAsync(uri);
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [left, top, right, bottom] = box;
  if (left <= 0 && top <= 0 && right >= 1 && bottom >= 1) return null;
  return [left, top, right, bottom];
}

/** Dibuja la tapa (primera página) en covers/{bookId}.jpg y devuelve su ruta. */
export async function renderPdfCover(bookId: string, uri: string): Promise<string | null> {
  if (!FileSystem.documentDirectory) return null;
  try {
    const dir = `${FileSystem.documentDirectory}covers`;
    await ensureDirectory(dir);
    const filePath = `${dir}/${bookId}.jpg`;
    await getBardoPdfModule().renderPageAsync(uri, 0, COVER_WIDTH_PX, null, null, filePath);
    return filePath;
  } catch {
    return null; // una portada que falla no debe frenar la apertura
  }
}

/** Libera el PDF abierto en el módulo nativo (al salir del lector). */
export async function closePdf(): Promise<void> {
  if (!isBardoPdfAvailable()) return;
  await getBardoPdfModule().closeAsync().catch(() => {});
}

export async function clearBookPages(bookId: string): Promise<void> {
  await FileSystem.deleteAsync(bookPagesDirectory(bookId), { idempotent: true }).catch(() => {});
}

export async function clearAllPdfPages(): Promise<void> {
  await FileSystem.deleteAsync(getPagesRoot(), { idempotent: true }).catch(() => {});
}

/** Al pasar el tope borra los libros menos usados (carpeta entera, por mtime). */
async function enforcePageCacheLimit(): Promise<void> {
  try {
    const root = getPagesRoot();
    const books = await FileSystem.readDirectoryAsync(root);
    const entries = await Promise.all(
      books.map(async (name) => {
        const dir = `${root}/${name}`;
        const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
        let size = 0;
        let mtime = 0;
        for (const file of files) {
          const info = await FileSystem.getInfoAsync(`${dir}/${file}`);
          if (info.exists) {
            size += info.size ?? 0;
            mtime = Math.max(mtime, info.modificationTime ?? 0);
          }
        }
        return { dir, size, mtime };
      }),
    );
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= MAX_PAGE_CACHE_BYTES) return;

    entries.sort((a, b) => a.mtime - b.mtime); // menos usado primero
    // El más reciente (el libro abierto) nunca se borra.
    for (const entry of entries.slice(0, -1)) {
      if (total <= MAX_PAGE_CACHE_BYTES) break;
      await FileSystem.deleteAsync(entry.dir, { idempotent: true }).catch(() => {});
      total -= entry.size;
    }
  } catch {
    // La limpieza de caché nunca debe romper la lectura.
  }
}
