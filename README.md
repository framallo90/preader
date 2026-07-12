# Bardo

Lector personal de PDFs para Android. Importá un PDF, EPUB, TXT o DOCX y escuchalo narrado con una voz de alta calidad mientras ves la página real del documento — la narración sabe exactamente en qué página está y la pasa por vos. Pensado para sagas y libros densos, con foco en que leer y escuchar sean la misma experiencia, en el mismo punto.

*(English version: [README.en.md](./README.en.md))*

---

## Features

- **Lector visual real** — para PDFs procesados por el backend propio, la app muestra la página tal cual es (con imágenes y diagramación), ajustada al ancho de la pantalla y a la rotación del dispositivo, con scroll continuo, scrubber de páginas y modo pantalla completa.
- **Narración sincronizada a la página** — mientras suena el audio, la página que la voz está leyendo se marca (`🔊 N`) y la vista **pasa de página sola** siguiendo a la voz. Si te vas a mirar otra parte, un chip te lleva de vuelta a donde va la voz.
- **Una sola posición, dos formas de vivirla** — leer y escuchar comparten el mismo offset de carácter; podés alternar entre los dos modos y siempre retomás exactamente donde quedaste.
- **Backend propio para libros grandes** — un servicio corriendo en un servidor propio extrae el texto (PyMuPDF), lo limpia con el mismo pipeline determinístico que corre en el cliente, calcula el mapa de offsets por página, genera la portada y renderiza páginas bajo demanda. El teléfono nunca tiene que parsear un PDF gigante; si el servidor no responde, cae a un parser local con límites de seguridad.
- **Multi-formato** — PDF, EPUB, TXT y DOCX desde cualquier app del sistema o por escaneo de carpetas (estilo ReadEra).
- **Biblioteca por identidad de contenido** — cada libro se identifica por una huella de su contenido (no por nombre de archivo), así el progreso, los capítulos y el caché sobreviven a renombres o movidas. Biblioteca agrupada por carpeta, con portadas reales y orden natural.
- **Detección automática de capítulos POV** — para sagas como ASOIAF detecta encabezados `BRAN (1)`, `CATELYN (2)`, etc.
- **Contexto por capítulo + chat sin spoilers** — un LLM genera un resumen de "qué pasó antes" al entrar a un capítulo y responde preguntas usando solo lo que ya leíste.
- **Modo uso propio** — sin cuentas ni pagos: todo desbloqueado desde el arranque, pensado para correr con las claves de IA del propio desarrollador.
- **Modo oscuro** y **offline-first** — leer, escuchar y el progreso no dependen de la nube; solo la generación inicial de audio y el primer procesado de un libro grande necesitan red.

---

## Stack

### App

| Capa | Tecnología |
|---|---|
| App | React Native + Expo SDK 55 + TypeScript |
| Navegación | Expo Router (file-based) |
| Base de datos | SQLite via `expo-sqlite` |
| Reproducción | `expo-audio` |
| Imágenes de página | `expo-image` (caché en disco) |
| Extracción PDF local (fallback) | `expo-pdf-text-extract` (módulo nativo) |
| Parseo EPUB / DOCX | `jszip` / `mammoth` |
| Narración (TTS) | fal.ai — Kokoro, voz en español, llamado directo desde la app |
| LLM (contexto, chat) | Hugging Face Inference Providers — Llama 3.3 70B, endpoint OpenAI-compatible |
| Tests | Vitest (funciones puras: detección de capítulos, bloques de texto, progreso, mapeo de páginas) |

La app **requiere una development build** (EAS o `expo run:android`). No funciona en Expo Go por los módulos nativos.

### Backend propio (`server/`)

Servicio Node.js + Python, pensado para correr en un servidor propio, aislado de cualquier otra app que conviva ahí (proceso y puerto propios, prioridad baja de CPU/IO).

| Pieza | Rol |
|---|---|
| `server.js` (Express) | Endpoints: subir libro, consultar estado, bajar texto limpio, portada, página renderizada |
| `pipeline.js` | Cola de a un libro por vez; orquesta extracción → limpieza → mapa de offsets |
| `extract.py` (PyMuPDF) | Extrae texto por página, genera la portada, calcula el aspect ratio de página |
| `render_page.py` (PyMuPDF) | Renderiza una página puntual como PNG al ancho pedido (cacheado en disco) |
| `textClean.js` | Puerto exacto en JS de la limpieza de texto del cliente (`chapterDetector.ts` / `textBlocks.ts`) — **si se cambia una regla, hay que cambiarla en los dos lados** |
| `fingerprint.js` | Misma huella de contenido que el cliente (SHA-256 de los primeros 256 KB + tamaño), para que ambos lados identifiquen el libro igual |

---

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar claves de IA (modo uso propio)

Las claves viven en `src/config/apiKeys.ts` (gitignoreado, nunca se commitea):

```ts
export const HF_TOKEN = '...';          // Hugging Face — permiso "Inference Providers"
export const FAL_KEY = '...';           // fal.ai — https://fal.ai/dashboard/keys
export const BARDO_SERVER_URL = '...';  // URL:puerto del backend propio (server/)
export const BARDO_TOKEN = '...';       // debe coincidir con BARDO_TOKEN del .env del server
```

⚠️ Estas claves quedan embebidas en el APK: sirve para uso propio, no para distribución pública (ahí correspondería un proxy de servidor que nunca exponga las claves al cliente). Nota: como `apiKeys.ts` está gitignoreado pero EAS excluye por defecto los archivos ignorados por git, el repo incluye un `.easignore` que replica `.gitignore` **sin** esa línea, para que el build sí incluya las claves.

Existe también un modelo freemium más antiguo (login + Supabase + MercadoPago) detrás de la bandera `PERSONAL_MODE` en `src/config/appMode.ts`. Está inactivo por defecto (`PERSONAL_MODE = true`); poner el flag en `false` reactiva login y premium, y ahí sí aplica `SUPABASE_SETUP.md`.

### 3. (Opcional) Levantar el backend propio

```bash
cd server
npm install
python3 -m venv venv && ./venv/bin/pip install pymupdf
cp .env.example .env   # PORT + BARDO_TOKEN (debe coincidir con el de la app)
npm start
```

Sin este servicio la app sigue funcionando: cae al parser local (con un techo de páginas para no quedarse sin memoria) y no hay lector visual de páginas ni portadas generadas del lado del servidor.

### 4. Build y correr

```bash
# Dev con dispositivo conectado (recarga de JS al instante tras el primer build)
npx expo run:android

# Build APK para testing interno
eas build --profile preview --platform android

# Type-check
npm run typecheck

# Tests (funciones puras, sin dispositivo)
npm test
```

---

## Arquitectura

### Modelo de datos

```
Book (libro)
 └── Chapter (capítulo detectado del texto)
      ├── povCharacter   — "BRAN", "CATELYN", null
      ├── startChar / endChar — offset en fullText
      └── ChapterContext — resumen y personajes generados por el LLM
```

El progreso se guarda por offset de carácter en `fullText`, no por número de bloque ni de página — es lo que permite que leer y escuchar compartan una sola posición.

### Pipeline de importación

```
PDF / EPUB / TXT / DOCX
  → ¿backend disponible? ──sí──► subir → extractText (PyMuPDF, por página)
  │                               → limpieza determinística (regex, igual que el cliente)
  │                               → mapa de offsets por página (pageForChar / charForPage)
  │                               → portada + páginas renderizadas bajo demanda
  │                               → texto limpio + metadata al cliente
  └──no / falla──► parser local (mismo pipeline de limpieza, con techo de páginas por memoria)
  → detectChapters()  ← índice POV automático
  → caché local (SQLite si es chico; archivos en disco si es grande)
```

### Pipeline de audio

```
fullText (ya limpio)
  → buildSynthesisChunks()   ← tramos que cortan SOLO en fin de oración
  → synthesizeSpeech()       ← fal.ai (Kokoro, voz español) → WAV cacheado (LRU, tope de disco)
  → expo-audio player
  → posición interpolada (tiempo de audio → offset de carácter → página, vía pageOffsets)
```

### Lector visual y sincronía de página

- `PdfPageList` — lista de páginas renderizadas por el backend (`GET /books/:id/page/:n?w=`), memoizada para que los ticks de audio no vuelvan a dibujar la lista entera.
- El offset de cada página (`pageOffsets`, calculado por el server) permite saber con exactitud en qué página está la voz, aunque las primeras páginas (tapa, índice) casi no tengan texto.
- Auto-seguimiento: si estás viendo la página que la voz lee, la vista pasa de página con ella (con un pequeño adelanto para compensar el desfase de la interpolación); si te fuiste a otra parte, un chip `🔊 pág. N →` te lleva de vuelta.

### Servicios clave

- `documentAudioPlaybackService` — singleton, gestiona el player, arma y prepara tramos, prefetch del siguiente mientras suena el actual.
- `bardoServerService` — sube el libro al backend, hace polling del estado, baja texto/portada/páginas; expone `isServerConfigured()` para el fallback local.
- `openaiTtsService` (nombre legado) — llama a fal.ai y cachea el WAV en `documentDirectory/tts-cache/`, con un tope de tamaño total.
- `claudeService` (nombre legado) — llama al LLM de Hugging Face para contexto de capítulo y chat.
- `useReaderController` — hook que conecta la UI con el playback service y mapea el tiempo de audio a `(blockIndex, charIndex)`.

---

## Estructura del proyecto

```
app/                    # Pantallas (Expo Router)
  index.tsx             # Home: biblioteca por carpetas, portadas, importar
  reader.tsx            # Lector: páginas del PDF + barra de audio flotante
  settings.tsx          # Configuración
src/
  components/
    PdfPageList.tsx     # Lector visual (páginas del server, fit-to-width, rotación)
    BookGridItem.tsx    # Tarjeta de biblioteca (portada + progreso)
  hooks/                # useAppSettings, useReaderController
  services/
    bardoServerService.ts     # Cliente del backend propio
    openaiTtsService.ts       # TTS vía fal.ai (nombre legado)
    claudeService.ts          # LLM vía Hugging Face (nombre legado)
    documentAudioPlaybackService.ts
    parsers/            # Fallback local: pdfDocumentParser, epubDocumentParser, etc.
  storage/               # Repositories SQLite
  types/
    document.ts          # ParsedDocument, ChapterInfo, TextBlock
  utils/
    chapterDetector.ts    # Regex POV + limpieza de tabs (espejo de server/textClean.js)
    textBlocks.ts         # buildTextBlocks, normalizeExtractedText
    synthesisSegments.ts  # buildSynthesisChunks (corta solo en fin de oración)
    pageMap.ts            # pageForChar / charForPage (sincronía voz↔página)
    *.test.ts              # Tests Vitest de las funciones puras de arriba
server/                  # Backend propio (ver sección de arquitectura)
```

---

## Convenciones

- Toda la UI está en español.
- Los repositories son objetos planos con métodos async (no clases).
- `void` intencional en llamadas fire-and-forget dentro de event handlers.
- El progreso se guarda máximo cada ~700ms–1.5s para no saturar SQLite.
- `parsedDocumentRepository` cachea libros chicos inline en SQLite y libros grandes como archivos en disco (`documentDirectory/parsed-cache/`).
- Cualquier regla de limpieza de texto que cambie en `src/utils/chapterDetector.ts` / `textBlocks.ts` debe replicarse en `server/textClean.js`, y viceversa.
- Loop de desarrollo: `npx expo run:android` una vez (compila nativo), después `npx expo start` recarga JS al instante — no hace falta un build de EAS por cada cambio de lógica.
