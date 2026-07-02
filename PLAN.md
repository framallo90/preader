# intelliReader — Plan de Evolución

## Contexto

App móvil para leer la saga Canción de Hielo y Fuego (y cualquier otra saga densa).
Stack: React Native + Expo + TypeScript + SQLite.

---

## Nueva arquitectura

### Jerarquía de datos

```
Saga
 └── Libro (Book)
      └── Capítulo (Chapter) ← detectado automáticamente del texto
           ├── Personaje POV (BRAN, CATELYN, JON…)
           ├── Bloques de texto (para el reproductor)
           └── Contexto IA (generado por Claude al terminar el capítulo)
```

### Estructura de carpetas nueva

```
src/
├── types/
│   ├── document.ts        ← expandido con ChapterInfo
│   ├── storage.ts         ← expandido con Saga, Book, Character
│   └── ai.ts              ← nuevo: ChapterContext, CharacterProfile
│
├── services/
│   ├── parsers/
│   │   ├── pdfDocumentParser.ts     ← existente, expandido
│   │   ├── epubDocumentParser.ts    ← nuevo
│   │   ├── txtDocumentParser.ts     ← nuevo
│   │   └── docxDocumentParser.ts    ← nuevo
│   ├── parserRegistry.ts            ← expandido con nuevos formatos
│   ├── claudeService.ts             ← nuevo: preprocessing + contexto
│   ├── openaiTtsService.ts          ← nuevo: reemplaza el módulo nativo
│   ├── chapterContextService.ts     ← nuevo: orquesta extracción de contexto
│   ├── documentAudioPlaybackService.ts  ← existente
│   ├── filePickerService.ts         ← expandido: acepta PDF/EPUB/TXT/DOCX
│   └── audioSessionService.ts       ← existente
│
├── storage/
│   ├── database.ts              ← expandido con nuevas tablas
│   ├── sagaRepository.ts        ← nuevo
│   ├── bookRepository.ts        ← nuevo (reemplaza recentFilesRepository)
│   ├── chapterRepository.ts     ← nuevo
│   ├── characterRepository.ts   ← nuevo
│   ├── chapterContextRepository.ts ← nuevo
│   ├── parsedDocumentRepository.ts ← existente
│   ├── progressRepository.ts       ← adaptado a Book
│   └── settingsRepository.ts       ← existente
│
└── utils/
    ├── textBlocks.ts       ← expandido: detectChapters()
    ├── chapterDetector.ts  ← nuevo: regex POV + normalización
    └── ...resto existente
```

---

## Schema SQLite nuevo

```sql
-- Sagas (ej: "Canción de Hielo y Fuego")
CREATE TABLE IF NOT EXISTS sagas (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  createdAt TEXT NOT NULL
);

-- Libros dentro de una saga (o sueltos)
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  sagaId TEXT,                    -- null si es libro suelto
  name TEXT NOT NULL,
  orderIndex INTEGER NOT NULL DEFAULT 0,
  uri TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'application/pdf', 'application/epub+zip', etc.
  importedAt TEXT NOT NULL,
  lastOpenedAt TEXT NOT NULL,
  FOREIGN KEY (sagaId) REFERENCES sagas(id) ON DELETE SET NULL
);

-- Capítulos detectados automáticamente
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY NOT NULL,
  bookId TEXT NOT NULL,
  orderIndex INTEGER NOT NULL,
  title TEXT NOT NULL,            -- "BRAN (1)", "PRÓLOGO", etc.
  povCharacter TEXT,              -- "BRAN", "CATELYN", null si no es POV
  povNumber INTEGER,              -- 1, 2, 3...
  startChar INTEGER NOT NULL,
  endChar INTEGER NOT NULL,
  FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
);

-- Personajes acumulados de la saga
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY NOT NULL,
  sagaId TEXT,
  name TEXT NOT NULL,
  aliases TEXT,                   -- JSON array: ["Ned", "Lord Stark"]
  house TEXT,
  description TEXT,               -- generado por Claude
  firstSeenBookId TEXT,
  firstSeenChapterId TEXT,
  updatedAt TEXT NOT NULL
);

-- Contexto IA por capítulo (generado por Claude)
CREATE TABLE IF NOT EXISTS chapter_context (
  chapterId TEXT PRIMARY KEY NOT NULL,
  beforeSummary TEXT,             -- qué recordar antes de leer
  afterSummary TEXT,              -- resumen al terminar
  charactersJson TEXT,            -- JSON: personajes que aparecen
  keyEventsJson TEXT,             -- JSON: eventos importantes
  extractedAt TEXT NOT NULL,
  FOREIGN KEY (chapterId) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Progreso de lectura (ahora por libro + capítulo)
CREATE TABLE IF NOT EXISTS reading_progress (
  bookId TEXT PRIMARY KEY NOT NULL,
  chapterId TEXT,
  blockIndex INTEGER NOT NULL,
  charIndex INTEGER,
  percentage REAL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
);

-- Settings (sin cambios)
-- parsed_document_cache (sin cambios)
-- documents (se mantiene para compatibilidad, deprecated)
```

---

## Detección de capítulos POV

El patrón en los PDFs de ASOIAF:
```
BRAN\t(1)
CATELYN\t(2)
PRÓLOGO
EPÍLOGO
```

Regex:
```typescript
// Capítulo POV con número
const POV_CHAPTER = /^([A-ZÁÉÍÓÚÑÜ\s]+)\t\((\d+)\)$/

// Capítulo especial (PRÓLOGO, EPÍLOGO, etc.)
const SPECIAL_CHAPTER = /^(PRÓLOGO|EPÍLOGO|PREFACIO|PRESENTACIÓN)$/
```

La detección corre sobre el texto extraído del PDF y genera el array de `ChapterInfo` automáticamente.

---

## Nuevos formatos soportados

| Formato | MIME type | Parser | Método |
|---------|-----------|--------|--------|
| PDF | application/pdf | pdfDocumentParser | expo-pdf-text-extract (ya funciona) |
| EPUB | application/epub+zip | epubDocumentParser | jszip + parseo HTML interno |
| TXT | text/plain | txtDocumentParser | expo-file-system read directo |
| DOCX | application/vnd.openxmlformats-officedocument.wordprocessingml.document | docxDocumentParser | mammoth.js |

Dependencias nuevas a instalar:
```bash
npx expo install jszip
npx expo install mammoth
```

---

## Servicios de IA

### claudeService.ts

Dos funciones principales:

**1. preprocessTextForTTS(rawText: string): Promise<string>**
- Limpia tabs y artefactos de conversión PDF
- Une palabras cortadas con guión al final de línea
- Normaliza puntuación para pausas naturales
- Convierte diálogos (—dijo María—) a formato hablable
- Convierte números y siglas a texto

**2. extractChapterContext(chapterText: string, previousContext: string): Promise<ChapterContext>**
- Personajes que aparecen en el capítulo
- Qué recordar del capítulo anterior
- Resumen de lo importante (para después de leer)
- Glosario de términos complejos si los hay
- Sin spoilers de lo que viene después

### openaiTtsService.ts

- Modelo: `tts-1-hd` con voz `onyx` (narrativa profunda) o `nova`
- Input: texto preprocesado por Claude
- Output: archivo `.mp3` cacheado en `FileSystem.documentDirectory`
- Cache key: `{chapterId}-{voiceId}.mp3`
- Si el MP3 ya existe en disco, lo sirve sin llamar a la API

---

## Prioridades de implementación

1. **Schema SQLite + tipos TypeScript** — base de todo
2. **Detección de capítulos POV** — visible inmediatamente, muy impactante
3. **Soporte multi-formato** — TXT es trivial, EPUB y DOCX después
4. **OpenAI TTS** — reemplaza el módulo nativo, mejora dramática del audio
5. **Claude preprocessing** — texto limpio = audio perfecto
6. **Contexto por capítulo** — la feature diferenciadora para sagas densas
7. **Chat compañero sin spoilers** — sobre todo lo anterior

---

## Notas de migración

El código actual usa `documents` y `StoredDocument`. La migración es:
- `documents` → `books` (misma estructura, agrega `sagaId` y `orderIndex`)
- `recentFilesRepository` → `bookRepository` (misma lógica)
- `progressRepository` → se adapta para referenciar `bookId` en lugar de `documentId`
- `parsedDocumentRepository` → sin cambios (cache de texto)

Los archivos de audio cacheados en el sistema nativo se migran o se regeneran con OpenAI TTS.
