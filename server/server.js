/**
 * bardo-api — backend de procesamiento de libros (espacio propio, puerto 3010).
 * Convive con booklo/investy sin tocarlos: carpeta, proceso y puerto propios.
 *
 *   POST /books                sube un PDF/EPUB/TXT → lo encola y devuelve el id
 *   GET  /books/:id            estado: queued|extracting|cleaning|ready|error
 *   GET  /books/:id/fulltext   texto limpio completo (text/plain)
 *   GET  /health               ping sin auth
 *
 * Auth: Authorization: Bearer <BARDO_TOKEN>  (token en .env)
 */
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import { createBookFingerprint } from './fingerprint.js';
import { BOOKS_DIR, PIPELINE_VERSION, STORAGE_DIR, bookDir, enqueueBook, isValidBookId, reconcileInterrupted, readStatus } from './pipeline.js';

const PORT = Number(process.env.PORT ?? 3010);
const TOKEN = process.env.BARDO_TOKEN ?? '';
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.epub', '.txt']);

if (!TOKEN) {
  console.error('Falta BARDO_TOKEN en .env — no arranco sin auth.');
  process.exit(1);
}

await mkdir(BOOKS_DIR, { recursive: true });
const uploadsDir = path.join(STORAGE_DIR, 'uploads');
await mkdir(uploadsDir, { recursive: true });

// Reanima zombies de un reinicio previo (ver reconcileInterrupted).
await reconcileInterrupted();

const upload = multer({ dest: uploadsDir, limits: { fileSize: MAX_UPLOAD_BYTES } });
const app = express();

// Borra un archivo temporal de multer sin romper si ya no está.
const cleanupTemp = (file) => { if (file?.path) void unlink(file.path).catch(() => {}); };

// Comparación de token en tiempo constante (evita timing attack sobre el Bearer).
const EXPECTED_AUTH = Buffer.from(`Bearer ${TOKEN}`);
function isAuthorized(header) {
  const got = Buffer.from(header ?? '');
  return got.length === EXPECTED_AUTH.length && timingSafeEqual(got, EXPECTED_AUTH);
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (!isAuthorized(req.headers.authorization)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.post('/books', upload.single('file'), async (req, res) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'missing_file' });

    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      cleanupTemp(file);
      return res.status(400).json({ error: 'unsupported_format' });
    }

    const bookId = await createBookFingerprint(file.path, file.originalname);

    // Si ya está procesado con el pipeline actual (o en cola), no repetir
    // trabajo. Un libro de una versión vieja se re-procesa (trae mejoras).
    const existing = await readStatus(bookId);
    const upToDate = existing && (existing.pipelineVersion ?? 1) >= PIPELINE_VERSION;
    if (existing && existing.status !== 'error' && (existing.status !== 'ready' || upToDate)) {
      cleanupTemp(file); // el libro ya existe: no encolamos, hay que borrar el temp.
      return res.json({ id: bookId, status: existing.status });
    }

    // enqueueBook mueve (rename) el temp a su destino final → no lo borramos acá.
    await enqueueBook({
      bookId,
      sourcePath: file.path,
      originalName: file.originalname,
      sizeBytes: file.size,
    });
    res.status(202).json({ id: bookId, status: 'queued' });
  } catch (error) {
    console.error('POST /books', error);
    cleanupTemp(file);
    res.status(500).json({ error: 'upload_failed' });
  }
});

app.get('/books/:id', async (req, res) => {
  const status = await readStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'not_found' });
  res.json(status);
});

/**
 * Página del libro renderizada como PNG al ancho pedido (?w=1080).
 * Se cachea por página+ancho (anchos redondeados a 256 px para no explotar
 * el disco). Es lo que alimenta el "modo lectura visual" de la app.
 */
const ROOT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PYTHON_BIN = path.join(ROOT_DIR, 'venv', 'bin', 'python3');
const RENDER_SCRIPT = path.join(ROOT_DIR, 'render_page.py');

// Límite de renders de página en paralelo: sin esto, arrastrar el scrubber
// dispara una ráfaga de requests y cada uno spawnea un Python que abre el PDF
// entero → pico de RAM que podría molestar a booklo/investy en el mismo server.
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;
const renderWaiters = [];
async function acquireRenderSlot() {
  if (activeRenders < MAX_CONCURRENT_RENDERS) { activeRenders++; return; }
  await new Promise((resolve) => renderWaiters.push(resolve));
  activeRenders++;
}
function releaseRenderSlot() {
  activeRenders--;
  const next = renderWaiters.shift();
  if (next) next();
}

app.get('/books/:id/page/:n', async (req, res) => {
  try {
    const status = await readStatus(req.params.id);
    if (!status || status.status !== 'ready') return res.status(404).json({ error: 'not_found' });

    const pageIndex = Number.parseInt(req.params.n, 10);
    const totalPages = Number(status.pages ?? 0);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= totalPages) {
      return res.status(400).json({ error: 'page_out_of_range' });
    }

    const requestedWidth = Number.parseInt(String(req.query.w ?? '1080'), 10) || 1080;
    const bucketWidth = Math.max(512, Math.min(2048, Math.ceil(requestedWidth / 256) * 256));

    const dir = bookDir(req.params.id);
    const pagesDir = path.join(dir, 'pages');
    await mkdir(pagesDir, { recursive: true });
    const cached = path.join(pagesDir, `p${pageIndex}-w${bucketWidth}.png`);

    if (!existsSync(cached)) {
      const source = readdirSync(dir).find((f) => f.startsWith('source.'));
      if (!source) return res.status(404).json({ error: 'source_missing' });
      // Render atómico: escribe a un tmp y recién al terminar lo renombra al
      // path final. Si el proceso muere a mitad (timeout), nunca queda un PNG
      // parcial servido para siempre con Cache-Control immutable.
      const tmp = `${cached}.tmp-${process.pid}-${pageIndex}`;
      await acquireRenderSlot();
      try {
        await execFileAsync(
          'nice',
          ['-n', '15', PYTHON_BIN, RENDER_SCRIPT, path.join(dir, source), String(pageIndex), String(bucketWidth), tmp],
          { timeout: 60_000, maxBuffer: 1024 * 1024 },
        );
        await rename(tmp, cached);
      } catch (renderError) {
        await unlink(tmp).catch(() => {});
        throw renderError;
      } finally {
        releaseRenderSlot();
      }
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(cached).pipe(res);
  } catch (error) {
    console.error('GET page', error);
    res.status(500).json({ error: 'render_failed' });
  }
});

app.get('/books/:id/cover', async (req, res) => {
  const status = await readStatus(req.params.id);
  if (!status || !status.hasCover) return res.status(404).json({ error: 'not_found' });
  const filePath = path.join(bookDir(req.params.id), 'cover.png');
  if (!existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'image/png');
  createReadStream(filePath).pipe(res);
});

app.get('/books/:id/fulltext', async (req, res) => {
  const status = await readStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'not_found' });
  if (status.status !== 'ready') return res.status(409).json({ error: 'not_ready', status: status.status });

  const filePath = path.join(bookDir(req.params.id), 'fulltext.txt');
  if (!existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  createReadStream(filePath).pipe(res);
});

app.listen(PORT, () => {
  console.log(`bardo-api escuchando en :${PORT}`);
});
