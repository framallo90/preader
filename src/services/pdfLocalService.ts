/**
 * pdfLocalService.ts
 *
 * Todo el trabajo de PDF en el teléfono (módulo nativo bardo-pdf): páginas
 * renderizadas a demanda, texto por página, portada y recorte de márgenes.
 * Reemplaza al backend: abrir un libro ya no sube nada ni espera a la red.
 *
 * Los cómics (módulo bardo-archive) usan la misma cola y el mismo caché: para el
 * lector, una página es una página, venga de un PDF o de un CBR.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Dimensions, PixelRatio } from 'react-native';

import { ComicInfo, getBardoArchiveModule, isBardoArchiveAvailable } from '../../modules/bardo-archive';
import { PdfColorMode, PdfCropBox, PdfExtraction, getBardoPdfModule, isBardoPdfAvailable } from '../../modules/bardo-pdf';

export type { PdfColorMode, PdfCropBox };

export type PageSourceKind = 'pdf' | 'comic';

export type PdfPageRequest = {
  bookId: string;
  /** De dónde sale la página; por defecto, un PDF. */
  kind?: PageSourceKind;
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
// Hay páginas nuevas desde la última poda: se limpia al cerrar el libro.
let prunePending = false;
// El libro cuyas páginas se están pidiendo ahora: la poda del caché no lo toca.
let activeBookId: string | null = null;

export function isLocalPdfAvailable(): boolean {
  return isBardoPdfAvailable();
}

export function isComicReaderAvailable(): boolean {
  return isBardoArchiveAvailable();
}

/** Cantidad de páginas y proporción típica de un cómic (lee solo el índice del archivo). */
export async function getComicInfo(uri: string): Promise<ComicInfo> {
  return getBardoArchiveModule().comicInfoAsync(uri);
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

/**
 * Ancho en píxeles al que se dibujan las páginas: el de la pantalla, no el del
 * contenedor. Así la página inicial se puede pedir ANTES de que el lector mida su
 * layout, y el caché no depende de unos píxeles de margen.
 */
export function canonicalPageWidthPx(): number {
  return Math.min(2048, Math.round(Dimensions.get('window').width * PixelRatio.get()));
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
  const { uri, pageIndex, widthPx, colorMode, crop, bookId, kind } = active.request;

  ensureDirectory(bookPagesDirectory(bookId))
    .then(() =>
      kind === 'comic'
        ? getBardoArchiveModule().renderComicPageAsync(uri, pageIndex, Math.round(widthPx), active.filePath)
        : getBardoPdfModule().renderPageAsync(
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
      // La poda revisa TODOS los archivos del caché de páginas (más de mil en un
      // tomo largo): correrla cada 40 páginas era un tirón justo mientras el
      // usuario pasa páginas. Ahora queda pendiente y se hace al cerrar el
      // libro, que es cuando no molesta.
      renderedSinceEviction += 1;
      if (renderedSinceEviction >= 40) prunePending = true;
      pumpRenderQueue();
    });
}

/**
 * Pide una página dibujada. Si ya está en disco se resuelve sin pasar por la
 * cola; si no, se encola. Varios pedidos de la misma página comparten trabajo.
 */
export function requestPdfPage(request: PdfPageRequest): PdfPageTicket {
  const { bookId, pageIndex, widthPx, colorMode, crop } = request;
  activeBookId = bookId;
  // Un cómic se muestra con sus colores, sin recorte: una sola versión por ancho.
  const variant = request.kind === 'comic' ? 'comic' : `${colorMode}-${cropKey(crop)}`;
  const fileName = `${pageIndex}-${Math.round(widthPx)}-${variant}.jpg`;
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

/** Rectángulo dentro de la página, en 0..1: [izquierda, arriba, derecha, abajo]. */
export type PageTextRect = [number, number, number, number];

/**
 * Dónde cae un texto dentro de una página del PDF, para resaltarlo.
 *
 * `hint` (0 a 1) dice por dónde está dentro de la página: el texto del libro
 * viene unido y limpiado, así que una posición global no corresponde uno a uno
 * con el índice de carácter crudo de la página. Buscar el texto cerca de la
 * pista es robusto a esa diferencia, que es de unos pocos renglones.
 */
export async function getPageTextRects(
  uri: string,
  pageIndex: number,
  needle: string,
  hint: number,
): Promise<PageTextRect[]> {
  if (!isLocalPdfAvailable() || needle.trim().length < 2) return [];
  try {
    const rects = await getBardoPdfModule().pageTextRectsAsync(uri, pageIndex, needle, hint);
    return rects.filter((r) => r.length === 4) as PageTextRect[];
  } catch {
    return []; // resaltar es un extra: si falla, se lee igual
  }
}

/**
 * Qué dice el PDF en el punto que tocaste, para citarlo exacto.
 *
 * `x` e `y` van de 0 a 1 sobre la página ENTERA: quien llama tiene que deshacer
 * antes el recorte de márgenes, porque lo que se ve en pantalla puede ser sólo
 * la caja de contenido. Devuelve la oración completa que hay ahí (no la letra
 * suelta) y dónde empieza dentro del texto crudo de la página.
 *
 * El texto viene con los renglones cortados donde los cortó la maquetación del
 * PDF; una cita con esos cortes adentro queda ilegible, así que se unen.
 */
export async function getTextAtPoint(
  uri: string,
  pageIndex: number,
  x: number,
  y: number,
): Promise<{ text: string; charInPage: number } | null> {
  if (!isLocalPdfAvailable()) return null;
  try {
    const hit = await getBardoPdfModule().textAtPointAsync(uri, pageIndex, x, y);
    if (!hit) return null;
    const text = hit.text.replace(/\s+/g, ' ').trim();
    return text.length > 0 ? { text, charInPage: hit.charInPage } : null;
  } catch {
    return null; // citar es un extra: si falla, queda la nota de la página entera
  }
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

/** Tapa de un cómic: su primera página. */
export async function renderComicCover(bookId: string, uri: string): Promise<string | null> {
  if (!FileSystem.documentDirectory) return null;
  try {
    const dir = `${FileSystem.documentDirectory}covers`;
    await ensureDirectory(dir);
    const filePath = `${dir}/${bookId}.jpg`;
    await getBardoArchiveModule().renderComicPageAsync(uri, 0, COVER_WIDTH_PX, filePath);
    return filePath;
  } catch {
    return null;
  }
}

/** Libera el PDF o el cómic abierto en los módulos nativos (al salir del lector). */
export async function closePdf(): Promise<void> {
  if (isBardoPdfAvailable()) await getBardoPdfModule().closeAsync().catch(() => {});
  if (isBardoArchiveAvailable()) await getBardoArchiveModule().closeAsync().catch(() => {});
  // Momento justo para limpiar el caché de páginas: el libro ya se cerró y no
  // hay nada que el usuario esté esperando en pantalla.
  void prunePageCacheIfNeeded().catch(() => {});
}

export async function clearBookPages(bookId: string): Promise<void> {
  await FileSystem.deleteAsync(bookPagesDirectory(bookId), { idempotent: true }).catch(() => {});
}

export async function clearAllPdfPages(): Promise<void> {
  await FileSystem.deleteAsync(getPagesRoot(), { idempotent: true }).catch(() => {});
}

/** Al pasar el tope borra los libros menos usados (carpeta entera, por mtime). */
export async function prunePageCacheIfNeeded(): Promise<void> {
  if (!prunePending) return;
  prunePending = false;
  renderedSinceEviction = 0;
  await enforcePageCacheLimit();
}

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
    // El más reciente nunca se borra, y tampoco el libro que se está pidiendo
    // AHORA: la poda arranca al cerrar el anterior, y si el nuevo tenía una
    // carpeta vieja se la borraba mientras dibujaba (páginas en blanco).
    const activeDir = activeBookId ? bookPagesDirectory(activeBookId) : null;
    for (const entry of entries.slice(0, -1)) {
      if (total <= MAX_PAGE_CACHE_BYTES) break;
      if (entry.dir === activeDir) continue;
      await FileSystem.deleteAsync(entry.dir, { idempotent: true }).catch(() => {});
      total -= entry.size;
    }
  } catch {
    // La limpieza de caché nunca debe romper la lectura.
  }
}
