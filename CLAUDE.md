# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check (primary static check — no unit tests)
npm run typecheck

# Start dev server (requires a development build, not Expo Go)
npx expo start

# Run on Android device/emulator (development build)
npx expo run:android

# EAS build — internal APK (sideload)
eas build --profile preview --platform android

# EAS build — production APK
eas build --profile production --platform android
```

## Packages

All runtime packages are installed (`jszip`, `mammoth`, `expo-speech`, `expo-secure-store`, `@supabase/supabase-js`, `react-native-url-polyfill`). The type stubs that used to live in `src/types/` were deleted when the real packages landed.

## Backend credentials

Edit `src/config/supabase.ts` with credentials from Supabase Dashboard → Project Settings → API:
```ts
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

API keys for Claude and OpenAI live exclusively as Supabase Edge Function secrets — never in the app. See `SUPABASE_SETUP.md`.

## Architecture

### Stack

React Native + Expo SDK 55 + TypeScript. Expo Router (file-based routing under `app/`). SQLite via `expo-sqlite`. Audio via `expo-audio`. Requires a development build — will **not** run in Expo Go.

### Central data type: `ParsedDocument`

Everything — playback, progress, word highlight, chapter detection — works from absolute character offsets into `fullText`. The type lives in `src/types/document.ts`:

```
ParsedDocument {
  fullText: string           ← single string for the whole file
  blocks: TextBlock[]        ← ~280-char UI display units, each knows startChar/endChar
  chapters: ChapterInfo[]    ← detected POV headers, each knows startChar/endChar
}
```

### Text processing pipeline (import flow)

```
File (PDF / EPUB / TXT / DOCX)
  → parserRegistry.ts            picks parser by MIME type
  → cleanPdfTabArtifacts()       preserves chapter-header tabs, cleans the rest
  → normalizeExtractedText()     newline normalization, hyphen-joins
  → buildTextBlocks()            splits into ~280-char blocks (target), max 420 (hard)
  → detectChapters()             finds ALL-CAPS POV headers (BRAN\t(1), PRÓLOGO, etc.)
  → ParsedDocument
  → parsedDocumentRepository     cached to SQLite (skipped if fullText > 500k or blocks > 4000)
```

`documentId` is derived from the filename (`uri.split('/').pop()`), not a UUID. Chapter IDs are `${bookId}--ch-${orderIndex}`.

### Audio pipeline

```
ParsedDocument.fullText
  → buildSynthesisChunks()      groups text into ~12k-char chunks (≤5 segments each)
  → claudeService.preprocessTextForTTS()   (premium) Haiku cleans PDF artifacts for TTS
  → openaiTtsService.synthesizeSpeech()    (premium) → MP3 cached at documentDirectory/tts-cache/
     or nativeTtsService.speak()           (free) → expo-speech, no cache
  → expo-audio player
```

**`documentAudioPlaybackService`** (singleton, `src/services/documentAudioPlaybackService.ts`) orchestrates everything: chunk preparation → load into `expo-audio` player → play → advance to next chunk → prefetch next while playing. Emits `PlaybackSnapshot` to subscribers.

**`useReaderController`** (`src/hooks/useReaderController.ts`) is the bridge between the reader UI and the playback service. It maps audio `currentTime` back to `(blockIndex, charIndex)` using binary search over blocks. Progress is throttled to persist at most every 700 ms.

**OpenAI TTS cache key**: `{chunkId}--{voice}--{model}.mp3` in `documentDirectory/tts-cache/`. If the file exists locally, the API is never called.

### Chapter detection (`src/utils/chapterDetector.ts`)

Tuned for lectulandia.com ASOIAF ePUB→PDF conversions:
- `POV_CHAPTER_PATTERN` — matches `BRAN\t(1)`, `CATELYN\t(2)` (ALL-CAPS + tab + number in parens)
- `SPECIAL_CHAPTER_PATTERN` — matches `PRÓLOGO`, `EPÍLOGO`, etc.
- `cleanPdfTabArtifacts()` replaces tabs between regular words with spaces but **preserves tabs inside chapter headers** — this ordering matters.

### Data model (SQLite)

```
sagas → books → chapters
                chapters → chapter_context
                chapters → reading_progress (one row per book, by charIndex)
sagas  → characters
books  → parsed_document_cache
```

All repositories are plain objects with async methods in `src/storage/`. The `documents` table and `recentFilesRepository` / `progressRepository` are legacy — kept for compatibility but not used in new code. Use `bookRepository` and `bookProgressRepository` instead.

**`runtimeStateRepository`** stores a "reader load guard" in the `settings` table: it's armed before parsing starts and cleared on success. On next boot, `_layout.tsx` detects a dangling guard and evicts the corrupt cache entry.

### Auth & freemium

- **`_layout.tsx`** — checks session on mount, redirects to `/login` if unauthenticated. Initializes `premiumService` on login, tears it down on logout.
- **`premiumService`** (singleton) — holds `isPremium`, subscribes to Supabase Realtime `postgres_changes` on `profiles` for instant post-payment activation.
- **Free tier**: `nativeTtsService` (expo-speech), all parsing and progress tracking.
- **Premium tier**: OpenAI TTS + Claude preprocessing + chapter context + chat. Gated by `premiumService.isPremium`.
- **Payments**: MercadoPago checkout URL opened via `Linking.openURL` → IPN webhook → `supabase/functions/mp-webhook` → `profiles.is_premium = true`.

### Supabase Edge Functions (`supabase/functions/`)

All AI and payment calls proxy through these Deno functions — keys never reach the APK:
- `claude/` — proxies Anthropic API, verifies `is_premium`
- `tts/` — proxies OpenAI TTS, returns base64-encoded MP3, verifies `is_premium`
- `create-payment/` — creates MercadoPago preference, returns `checkoutUrl`
- `mp-webhook/` — IPN receiver, activates premium via service role key (bypasses RLS)

### Screens (`app/`)

| File | Purpose |
|---|---|
| `_layout.tsx` | Auth guard, DB init, crash recovery, `AppSettingsProvider` |
| `login.tsx` | Email/password auth (login / register / reset) |
| `index.tsx` | Home: recent books, continue-reading card, import |
| `reader.tsx` | Main reader: audio controls, block list, chapter banner, voice picker |
| `chapter-context.tsx` | Full chapter context: beforeSummary, afterSummary, characters, keyEvents |
| `chat.tsx` | Multi-turn chat with Claude Sonnet using accumulated chapter contexts |
| `settings.tsx` | Dark mode, font, rate, voice, account section (premium badge + logout) |
| `subscription.tsx` | Freemium plans, MercadoPago checkout |

### Chapter context flow in `reader.tsx`

When `currentChapter` changes while reading:
1. Find chapter N-1 (previous by `orderIndex`). Load its `afterSummary` from `chapterContextRepository` → show in banner as "lo anterior".
2. Background: extract context for the chapter just left, save via `chapterContextRepository` and `characterRepository`. Update banner with `result.afterSummary` if still showing.
3. "Ver contexto completo →" navigates to `/chapter-context?chapterId={previousChapterId}`.

### Theme & colors

`src/utils/theme.ts` defines `lightColors` and `darkColors`. All colors flow through `useAppSettings()` which exposes `colors: ThemeColors`. Components receive `colors` as a prop — never hardcode color values.

### Key conventions

- All UI text is in Spanish.
- `void` on all fire-and-forget async calls in event handlers.
- Progress tracked by absolute character offset (`charIndex` into `fullText`), not block index.
- `parsedDocumentRepository` skips caching if `fullText > 500k chars` or `blocks > 4000`.
- `documentAudioPlaybackService` is a singleton — one `expo-audio` player instance app-wide.
- Writing files >~300 lines with the Write tool risks silent truncation. Use bash + Python for large file writes.

### Library model (ReadEra-style)

- **Content fingerprint**: `books.id` = `createBookFingerprint()` (SHA-256 of first 256KB + size, `bk_...`). Progress, chapters, context and TTS cache survive file renames/moves/re-downloads. Manual re-import upserts into the same row.
- **Folder scanning**: `libraryScanService.scanLibraryFolders()` runs on Home focus over SAF folders stored in `settings.libraryFolders`. Scanned books reference the file in place (`content://`); PDFs get a lazy local copy on first open (`ensureLocalPdfCopy`) because the native extractor needs `file://`. Deleted scanned books go to an ignore list (`library.ignoredBookIds` in settings table) so scans don't re-add them.
- **Metadata**: parsers return optional `metadata` (title/author/cover). `persistBookMetadata` writes the cover to `documentDirectory/covers/{bookId}` and updates the book row (COALESCE — never overwrites with null).
- **No account required**: the app boots to Home without a session. Login is only prompted from the subscription flow. Auth events only navigate on real login/logout transitions.
- **DB migrations**: `PRAGMA user_version` in `database.ts` (`runMigrations`). Any schema change on existing tables must be added there.

### What still needs to be wired

1. **Free-tier TTS in reader** — `nativeTtsService` exists but `documentAudioPlaybackService` still calls OpenAI TTS unconditionally. Non-premium users need routing through `nativeTtsService` instead (they currently get a friendly premium message on play).
2. **Character wiki screen** — `characterRepository` accumulates characters per saga; no UI screen yet.
3. **Streaming chat** — `chatWithSagaContext` returns the full response at once. Streaming via SSE would improve UX.
