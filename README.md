# intelliReader

Lector personal de sagas para Android. Importá PDFs, EPUBs, TXT o DOCX y escuchalos como audiolibro de alta calidad generado con OpenAI TTS. Diseñado especialmente para sagas densas con muchos personajes y tramas paralelas.

---

## Features

- **Audiolibro bajo demanda** — el audio se genera con OpenAI TTS (`tts-1-hd`) y se cachea en el dispositivo. Una vez generado, funciona sin conexión.
- **Multi-formato** — importa PDF, EPUB, TXT y DOCX desde cualquier app del sistema.
- **Detección automática de capítulos POV** — para sagas como ASOIAF detecta los capítulos `BRAN (1)`, `CATELYN (2)`, etc. y construye el índice automáticamente.
- **Organización en sagas** — agrupa libros en una saga con orden definido.
- **Seguimiento de progreso** — guarda posición exacta por offset de carácter y retoma desde donde lo dejaste.
- **Word highlight** — resalta la palabra que se está leyendo en tiempo real mientras suena el audio.
- **Temporizador de sueño** — pausa automática después de N minutos.
- **Modo oscuro** — tema claro/oscuro configurable.
- **Offline-first** — no depende de la nube para leer o escuchar (solo generación inicial de TTS).

### En desarrollo

- **Contexto por capítulo** — antes de escuchar un capítulo Claude genera un "qué recordar" con personajes y eventos del capítulo anterior. Al terminar, genera un resumen.
- **Chat compañero sin spoilers** — preguntale a Claude sobre personajes o eventos usando solo el contexto de lo que ya leíste.
- **Wiki de personajes** — Claude extrae y acumula perfiles de personajes capítulo a capítulo.

---

## Stack

| Capa | Tecnología |
|---|---|
| App | React Native + Expo SDK 55 + TypeScript |
| Navegación | Expo Router (file-based) |
| Base de datos | SQLite via `expo-sqlite` |
| Reproducción | `expo-audio` |
| Extracción PDF | `expo-pdf-text-extract` (módulo nativo) |
| Parseo EPUB | `jszip` |
| Parseo DOCX | `mammoth` |
| TTS | OpenAI TTS API (`tts-1-hd`) |
| Contexto IA | Claude API (`claude-haiku-4-5`) |

La app **requiere una development build** (EAS o `expo run:android`). No funciona en Expo Go por los módulos nativos.

---

## Setup

### 1. Instalar dependencias

```bash
npm install
npx expo install jszip mammoth
```

### 2. Configurar backend

Las API keys de Claude y OpenAI **nunca van en la app**: viven como secrets de las Edge Functions de Supabase. Seguí los pasos de [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) y completá `src/config/supabase.ts` con la URL y anon key de tu proyecto.

### 3. Build y correr

```bash
# Dev con dispositivo conectado
npx expo run:android

# Build APK para testing interno
eas build --profile preview --platform android

# Build APK producción
eas build --profile production --platform android

# Type-check
npm run typecheck
```

---

## Arquitectura

### Modelo de datos

```
Saga
 └── Book (libro)
      └── Chapter (capítulo detectado del texto)
           ├── povCharacter   — "BRAN", "CATELYN", null
           ├── startChar / endChar — offset en fullText
           └── ChapterContext — resumen y personajes generados por Claude
```

El progreso se guarda por offset de carácter en `fullText`, no por número de bloque, lo que permite retomar desde el audio en cualquier punto exacto.

### Pipeline de audio

```
PDF / EPUB / TXT / DOCX
  → parser correspondiente
  → cleanPdfTabArtifacts() + normalizeExtractedText()
  → buildTextBlocks()       ← bloques ~280 chars para la UI
  → detectChapters()        ← índice POV automático
  → buildSynthesisChunks()  ← chunks ~12k chars para TTS
  → synthesizeSpeech()      ← OpenAI TTS → MP3 cacheado
  → expo-audio player
```

### Servicios clave

- `documentAudioPlaybackService` — singleton, gestiona el player, orquesta chunks, prefetch del siguiente mientras suena el actual.
- `openaiTtsService` — llama a OpenAI TTS y cachea MP3 en `documentDirectory/tts-cache/`.
- `claudeService` — preprocesa texto para TTS y extrae contexto de capítulos.
- `useReaderController` — hook que conecta la UI con el playback service y mapea el tiempo de audio a `(blockIndex, charIndex)` para el word highlight.

---

## Estructura del proyecto

```
app/                    # Pantallas (Expo Router)
  index.tsx             # Home: libros recientes, importar
  reader.tsx            # Lector con audio y controles
  settings.tsx          # Configuración
src/
  components/           # Componentes UI reutilizables
  hooks/                # useAppSettings, useReaderController
  services/             # Lógica de negocio y APIs externas
    parsers/            # pdfDocumentParser, epubDocumentParser, etc.
    claudeService.ts
    openaiTtsService.ts
    documentAudioPlaybackService.ts
  storage/              # Repositories SQLite
    database.ts         # Schema e inicialización
    bookRepository.ts
    sagaRepository.ts
    chapterRepository.ts
    characterRepository.ts
    chapterContextRepository.ts
  types/
    document.ts         # ParsedDocument, ChapterInfo, TextBlock
    storage.ts          # Saga, Book, Chapter, Character, ChapterContext
  utils/
    chapterDetector.ts  # Regex POV + limpieza de tabs
    textBlocks.ts       # buildTextBlocks, normalizeExtractedText
    synthesisSegments.ts # buildSynthesisChunks
modules/
  voice-synthesizer/    # Módulo nativo legacy (reemplazado por OpenAI TTS)
```

---

## Convenciones

- Toda la UI está en español.
- Los repositories son objetos planos con métodos async (no clases).
- `void` intencional en llamadas fire-and-forget dentro de event handlers.
- El progreso se guarda máximo cada 700ms para no saturar SQLite.
- `parsedDocumentRepository` no cachea si `fullText > 500k chars` o `blocks > 4000`.
