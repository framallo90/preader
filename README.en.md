# Bardo

Personal PDF reader for Android. Import a PDF, EPUB, TXT or DOCX and listen to it narrated with a high-quality voice while looking at the actual page of the document — narration knows exactly which page it's on and turns it for you. Built for dense books and sagas, with a core focus on making reading and listening the same experience, at the same position.

*(Versión en español: [README.md](./README.md))*

---

## Features

- **Real visual reader** — for PDFs processed by the personal backend, the app shows the page as it actually is (images, layout and all), fit to screen width and rotation-aware, with continuous scroll, a page scrubber and a fullscreen mode.
- **Page-synced narration** — while audio plays, the page the voice is reading gets marked (`🔊 N`) and the view **auto-turns pages** following the voice. If you scroll away, a chip jumps you back to wherever the voice currently is.
- **One position, two ways to experience it** — reading and listening share the same character offset; you can switch between the two modes and always resume exactly where you left off.
- **Own backend for large books** — a service running on a personal server extracts text (PyMuPDF), cleans it with the same deterministic pipeline that runs on-device, computes the page-offset map, generates the cover and renders pages on demand. The phone never has to parse a huge PDF itself; if the server is unreachable, it falls back to a local parser with safety limits.
- **Multi-format** — PDF, EPUB, TXT and DOCX from any system app or by scanning folders (ReadEra-style).
- **Content-identity library** — every book is identified by a fingerprint of its content (not its filename), so progress, chapters and cache survive renames or moves. Library grouped by folder, with real cover art and natural sort order.
- **Automatic POV chapter detection** — for sagas like ASOIAF, detects headers like `BRAN (1)`, `CATELYN (2)`, etc.
- **Spoiler-free chapter recap + companion chat** — an LLM generates a "what to remember" recap when you enter a chapter and answers questions using only what you've already read.
- **Personal-use mode** — no accounts, no payments: everything unlocked from launch, meant to run on the developer's own AI credentials.
- **Dark mode** and **offline-first** — reading, listening and progress don't depend on the cloud; only the initial audio generation and the first processing of a large book need network access.

---

## Stack

### App

| Layer | Technology |
|---|---|
| App | React Native + Expo SDK 55 + TypeScript |
| Navigation | Expo Router (file-based) |
| Database | SQLite via `expo-sqlite` |
| Playback | `expo-audio` |
| Page images | `expo-image` (disk cache) |
| Local PDF extraction (fallback) | `expo-pdf-text-extract` (native module) |
| EPUB / DOCX parsing | `jszip` / `mammoth` |
| Narration (TTS) | fal.ai — Kokoro, Spanish voice, called directly from the app |
| LLM (context, chat) | Hugging Face Inference Providers — Llama 3.3 70B, OpenAI-compatible endpoint |
| Tests | Vitest (pure functions: chapter detection, text blocks, progress, page mapping) |

The app **requires a development build** (EAS or `expo run:android`). It does not work in Expo Go because of the native modules.

### Own backend (`server/`)

Node.js + Python service, meant to run on a personal server, isolated from any other app sharing it (its own process, its own port, low CPU/IO priority).

| Piece | Role |
|---|---|
| `server.js` (Express) | Endpoints: upload a book, poll status, fetch cleaned text, cover, rendered page |
| `pipeline.js` | One-book-at-a-time queue; orchestrates extraction → cleanup → offset mapping |
| `extract.py` (PyMuPDF) | Extracts text page by page, generates the cover, computes the page aspect ratio |
| `render_page.py` (PyMuPDF) | Renders a single page as a PNG at the requested width (cached on disk) |
| `textClean.js` | Exact JS port of the client's text cleanup (`chapterDetector.ts` / `textBlocks.ts`) — **if a rule changes, change it on both sides** |
| `fingerprint.js` | Same content fingerprint as the client (SHA-256 of the first 256 KB + size), so both sides agree on a book's identity |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure AI keys (personal-use mode)

Keys live in `src/config/apiKeys.ts` (gitignored, never committed):

```ts
export const HF_TOKEN = '...';          // Hugging Face — "Inference Providers" permission
export const FAL_KEY = '...';           // fal.ai — https://fal.ai/dashboard/keys
export const BARDO_SERVER_URL = '...';  // host:port of the own backend (server/)
export const BARDO_TOKEN = '...';       // must match BARDO_TOKEN in the server's .env
```

⚠️ These keys end up embedded in the APK: fine for personal use, not for public distribution (that would need a server-side proxy that never exposes the keys to the client). Note: since `apiKeys.ts` is gitignored but EAS excludes git-ignored files by default, the repo ships a `.easignore` that mirrors `.gitignore` **without** that line, so the build does include the keys.

There's also an older freemium model (login + Supabase + MercadoPago) behind the `PERSONAL_MODE` flag in `src/config/appMode.ts`. It's inactive by default (`PERSONAL_MODE = true`); flipping it to `false` re-enables login and premium, and that's where `SUPABASE_SETUP.md` applies.

### 3. (Optional) Run the own backend

```bash
cd server
npm install
python3 -m venv venv && ./venv/bin/pip install pymupdf
cp .env.example .env   # PORT + BARDO_TOKEN (must match the app's)
npm start
```

The app still works without this service: it falls back to the local parser (with a page-count ceiling to avoid running out of memory) and there's no visual page reader or server-generated covers.

### 4. Build and run

```bash
# Dev with a connected device (instant JS reload after the first build)
npx expo run:android

# Internal testing APK
eas build --profile preview --platform android

# Type-check
npm run typecheck

# Tests (pure functions, no device needed)
npm test
```

---

## Architecture

### Data model

```
Book
 └── Chapter (detected from the text)
      ├── povCharacter   — "BRAN", "CATELYN", null
      ├── startChar / endChar — offset into fullText
      └── ChapterContext — summary and characters generated by the LLM
```

Progress is saved as a character offset into `fullText`, not a block or page number — that's what lets reading and listening share a single position.

### Import pipeline

```
PDF / EPUB / TXT / DOCX
  → is the backend reachable? ──yes──► upload → extractText (PyMuPDF, per page)
  │                                    → deterministic cleanup (regex, same as the client)
  │                                    → per-page offset map (pageForChar / charForPage)
  │                                    → cover + pages rendered on demand
  │                                    → clean text + metadata back to the client
  └──no / fails──► local parser (same cleanup pipeline, page-count ceiling for memory safety)
  → detectChapters()  ← automatic POV index
  → local cache (SQLite if small; files on disk if large)
```

### Audio pipeline

```
fullText (already clean)
  → buildSynthesisChunks()   ← chunks that cut ONLY at sentence boundaries
  → synthesizeSpeech()       ← fal.ai (Kokoro, Spanish voice) → cached WAV (LRU, disk cap)
  → expo-audio player
  → interpolated position (audio time → character offset → page, via pageOffsets)
```

### Visual reader and page sync

- `PdfPageList` — list of pages rendered by the backend (`GET /books/:id/page/:n?w=`), memoized so audio ticks don't re-render the whole list.
- Each page's offset (`pageOffsets`, computed server-side) makes it possible to know exactly which page the voice is on, even when the first pages (cover, table of contents) have almost no text.
- Auto-follow: if you're looking at the page the voice is reading, the view turns pages along with it (with a small lookahead to compensate for interpolation lag); if you scrolled elsewhere, a `🔊 page N →` chip brings you back.

### Key services

- `documentAudioPlaybackService` — singleton, manages the player, builds and prepares chunks, prefetches the next one while the current one plays.
- `bardoServerService` — uploads the book to the backend, polls its status, downloads text/cover/pages; exposes `isServerConfigured()` for the local fallback.
- `openaiTtsService` (legacy name) — calls fal.ai and caches the WAV in `documentDirectory/tts-cache/`, with a total size cap.
- `claudeService` (legacy name) — calls the Hugging Face LLM for chapter context and chat.
- `useReaderController` — hook connecting the UI to the playback service, mapping audio time to `(blockIndex, charIndex)`.

---

## Project structure

```
app/                    # Screens (Expo Router)
  index.tsx             # Home: library by folder, covers, import
  reader.tsx            # Reader: PDF pages + floating audio bar
  settings.tsx          # Settings
src/
  components/
    PdfPageList.tsx     # Visual reader (server-rendered pages, fit-to-width, rotation)
    BookGridItem.tsx    # Library card (cover + progress)
  hooks/                # useAppSettings, useReaderController
  services/
    bardoServerService.ts     # Own backend client
    openaiTtsService.ts       # TTS via fal.ai (legacy name)
    claudeService.ts          # LLM via Hugging Face (legacy name)
    documentAudioPlaybackService.ts
    parsers/            # Local fallback: pdfDocumentParser, epubDocumentParser, etc.
  storage/               # SQLite repositories
  types/
    document.ts          # ParsedDocument, ChapterInfo, TextBlock
  utils/
    chapterDetector.ts    # POV regex + tab cleanup (mirrored by server/textClean.js)
    textBlocks.ts         # buildTextBlocks, normalizeExtractedText
    synthesisSegments.ts  # buildSynthesisChunks (cuts only at sentence boundaries)
    pageMap.ts            # pageForChar / charForPage (voice↔page sync)
    *.test.ts              # Vitest tests for the pure functions above
server/                  # Own backend (see architecture section)
```

---

## Conventions

- All UI text is in Spanish (the app's target audience).
- Repositories are plain objects with async methods (no classes).
- Intentional `void` on fire-and-forget calls inside event handlers.
- Progress is persisted at most every ~700ms–1.5s to avoid saturating SQLite.
- `parsedDocumentRepository` caches small books inline in SQLite and large books as files on disk (`documentDirectory/parsed-cache/`).
- Any text-cleanup rule change in `src/utils/chapterDetector.ts` / `textBlocks.ts` must be mirrored in `server/textClean.js`, and vice versa.
- Dev loop: `npx expo run:android` once (compiles native code), then `npx expo start` reloads JS instantly — no need for an EAS build per logic change.
