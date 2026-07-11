/**
 * Cola de procesamiento de libros: de a UNO por vez y con prioridad baja (nice),
 * para no molestar nunca a booklo/investy que conviven en el server.
 *
 * Pasos: extraer (PyMuPDF) → limpiar (regex, mismo pipeline que la app) → paquete.
 * Estado por libro en storage/books/<id>/status.json; texto en fulltext.txt.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { cleanFullText } from './textClean.js';

const execFileAsync = promisify(execFile);

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const STORAGE_DIR = path.join(ROOT, 'storage');
export const BOOKS_DIR = path.join(STORAGE_DIR, 'books');
const PYTHON = path.join(ROOT, 'venv', 'bin', 'python3');
const EXTRACT_SCRIPT = path.join(ROOT, 'extract.py');

/**
 * Versión del pipeline: si un libro fue procesado con una versión anterior,
 * una nueva subida lo re-procesa (así llegan mejoras como pageOffsets).
 */
export const PIPELINE_VERSION = 2;

const queue = [];
let processing = false;

export function bookDir(bookId) {
  return path.join(BOOKS_DIR, bookId);
}

export async function readStatus(bookId) {
  try {
    return JSON.parse(await readFile(path.join(bookDir(bookId), 'status.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function writeStatus(bookId, patch) {
  const current = (await readStatus(bookId)) ?? {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(path.join(bookDir(bookId), 'status.json'), JSON.stringify(next, null, 2));
  return next;
}

export async function enqueueBook({ bookId, sourcePath, originalName, sizeBytes }) {
  await mkdir(bookDir(bookId), { recursive: true });
  const finalSource = path.join(bookDir(bookId), `source${path.extname(originalName).toLowerCase() || '.bin'}`);
  await rename(sourcePath, finalSource);
  await writeStatus(bookId, {
    id: bookId,
    name: originalName,
    sizeBytes,
    status: 'queued',
    error: null,
    createdAt: new Date().toISOString(),
  });

  queue.push({ bookId, sourcePath: finalSource, originalName });
  void processNext();
}

async function processNext() {
  if (processing) return;
  const job = queue.shift();
  if (!job) return;
  processing = true;
  try {
    await processBook(job);
  } catch (error) {
    await writeStatus(job.bookId, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    processing = false;
    void processNext();
  }
}

async function processBook({ bookId, sourcePath, originalName }) {
  const dir = bookDir(bookId);
  const rawPath = path.join(dir, 'raw.txt');
  const fullTextPath = path.join(dir, 'fulltext.txt');
  const coverPath = path.join(dir, 'cover.png');

  // 1) Extracción con PyMuPDF (texto + portada), prioridad baja de CPU/IO.
  await writeStatus(bookId, { status: 'extracting' });
  const { stdout } = await execFileAsync(
    'nice',
    ['-n', '15', 'ionice', '-c', '3', PYTHON, EXTRACT_SCRIPT, sourcePath, rawPath, coverPath],
    { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 },
  );
  const meta = JSON.parse(stdout.trim() || '{}');
  if (meta.error) throw new Error(meta.error);

  // 2) Limpieza POR PÁGINA (regex — idéntica a la de la app) y armado del
  //    texto final registrando dónde empieza cada página. Ese mapa
  //    (pageOffsets) es lo que permite que la app sepa exactamente en qué
  //    página va la voz y qué página corresponde al progreso guardado.
  await writeStatus(bookId, { status: 'cleaning' });
  const rawJson = JSON.parse(await readFile(rawPath, 'utf8'));
  const rawPages = Array.isArray(rawJson.pages) ? rawJson.pages : [String(rawJson)];

  let fullText = '';
  const pageOffsets = [];
  for (const rawPage of rawPages) {
    const cleaned = cleanFullText(String(rawPage ?? ''));
    if (cleaned && fullText) fullText += '\n\n';
    pageOffsets.push(fullText.length);
    fullText += cleaned;
  }

  if (!fullText || fullText.replace(/[^A-Za-z0-9]/g, '').length < 20) {
    throw new Error('no_extractable_text');
  }
  await writeFile(fullTextPath, fullText, 'utf8');

  // 3) Paquete listo.
  await writeStatus(bookId, {
    status: 'ready',
    pipelineVersion: PIPELINE_VERSION,
    chars: fullText.length,
    pages: meta.pages ?? 0,
    title: meta.title ?? null,
    hasCover: Boolean(meta.cover),
    pageAspect: meta.pageAspect ?? null,
    pageOffsets: meta.pages ? pageOffsets : null,
  });
}
