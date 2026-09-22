# Bardo

Lector y narrador de libros para Android. Abrí un PDF, EPUB, TXT, DOCX o un cómic (CBZ, CBR, CB7, CBT) y leelo o escuchalo mientras ves la página real — la narración sabe en qué página está y la pasa por vos. Todo pasa en el teléfono: sin servidor, sin cuentas, sin claves de API y sin conexión. Abre al instante, como ReadEra.

*(English version: [README.en.md](./README.en.md))*

---

## Features

- **Apertura instantánea** — un PDF muestra sus páginas en el acto; el texto para la voz y la búsqueda se prepara de fondo. Los EPUB se convierten con un conversor nativo.
- **Lector visual real** — las páginas del PDF se dibujan en el teléfono tal cual son (con imágenes y diagramación), al ancho de la pantalla, con scroll continuo, barra de páginas, pantalla completa y recorte automático de márgenes blancos.
- **Cómics** — CBZ, CBR (RAR 4 y 5), CB7 y CBT, con el mismo progreso, marcadores, notas y listas que un libro.
- **PDF escaneados** — un PDF sin texto se abre igual en modo visual; solo queda sin voz.
- **Narración sincronizada a la página** — mientras suena el audio, la página que la voz está leyendo se marca (`🔊 N`) y la vista pasa de página sola. Si te vas a mirar otra parte, un chip te lleva de vuelta a donde va la voz.
- **Voz del teléfono, offline** — el audio lo genera el motor de texto a voz de Android. Se elige sola la mejor voz instalada según el idioma de cada libro, o la fijás vos en Ajustes. Sigue sonando con la pantalla bloqueada, con controles en la notificación, retroceso de 15 s y temporizador de sueño.
- **Una sola posición, dos formas de vivirla** — leer y escuchar comparten el mismo offset de carácter; alternás entre los dos modos y retomás exactamente donde quedaste.
- **Marcadores, citas y notas** — el marcador de la cabecera guarda donde estás; mantené apretado un párrafo o una página para guardar una cita o una nota.
- **Sobre este libro** — una sola pantalla por libro: reseña con estrellas, listas (Para leer / Leído / Favorito), colecciones, índice y todas las anotaciones, cada una con salto directo al lugar.
- **Biblioteca** — escaneo de carpetas (con subcarpetas excluidas), filtros por lista y colección, portadas reales, agrupado por carpeta y orden natural. Cada libro se identifica por una huella de su contenido, así el progreso sobrevive a renombres y movidas.
- **Índice real** — usa los marcadores del PDF o el índice del EPUB cuando existen; si no, detecta encabezados en el texto ("Capítulo 8", "PARTE II", "Chapter 3"…). Un toque en la barra inferior del lector.
- **Buscar en el libro** — sin distinguir tildes ni mayúsculas, con salto al resultado.
- **Temas de lectura** — día, sepia y noche, también sobre las páginas del PDF, más un atenuador para bajar el brillo por debajo del mínimo del sistema.
- **Interfaz ordenada** — barra inferior fija en el lector (Índice · Buscar · Aspecto · Voz · Pantalla), ajustes en cinco grupos, biblioteca con portadas, etiqueta de formato y progreso. Paleta "Tinta y lacre" (tinta `#3A3785` para lo accionable, lacre `#B8492E` para el avance); la página se mantiene calma. Identidad completa en `docs/brand/bardo-marca.md`. Detalle en `docs/research/bardo-ux-vs-readera.md`.

---

## Stack

| Capa | Tecnología |
|---|---|
| App | React Native + Expo SDK 55 + TypeScript |
| Navegación | Expo Router (file-based) |
| Base de datos | SQLite via `expo-sqlite` |
| PDF (render, texto, índice, portada, recorte) | Módulo nativo propio `modules/bardo-pdf` — `PdfRenderer` de Android + Pdfium nativo para el texto |
| Cómics (CBZ, CBR, CB7, CBT), EPUB (zip + HTML→texto), escaneo SAF y huella de archivos | Módulo nativo propio `modules/bardo-archive` — `java.util.zip` + 7-Zip nativo (RAR 4/5, 7z, tar) + conversor HTML propio (`HtmlText.kt`) |
| Voz | Módulo nativo propio `modules/voice-synthesizer` — `TextToSpeech.synthesizeToFile` de Android |
| Reproducción | `expo-audio` (background + pantalla bloqueada) |
| Parseo EPUB / DOCX | nativo (`bardo-archive`, con `jszip` de respaldo) / `mammoth` |
| Tests | Vitest (funciones puras) |

La app **requiere una development build** (EAS o `expo run:android`): tiene módulos nativos propios, así que no corre en Expo Go. Después de tocar algo dentro de `modules/` hay que volver a compilar la build.

---

## Setup

```bash
npm install

# Dev con dispositivo conectado (recarga de JS al instante tras el primer build)
npx expo run:android

# Build APK para testing interno
eas build --profile preview --platform android

# Type-check
npm run typecheck

# Tests (funciones puras, sin dispositivo)
npm test

# Test nativo del conversor HTML→texto (paridad con la versión JS; JVM, sin emulador)
cd android && ./gradlew :bardo-archive:testReleaseUnitTest
```

No hay claves ni servicios que configurar.

---

## Arquitectura

### Modelo de datos

```
Book (libro)  ── status · favorite · rating · review
 ├── Chapter            capítulo (índice del PDF o detectado del texto)
 ├── Note               marcador | cita | nota  (una sola tabla, distinguidas por type)
 ├── ReadingProgress    offset de carácter + porcentaje
 └── Collection  (N:N)  un libro puede estar en varias
```

Progreso, voz, búsqueda y anotaciones usan la misma unidad: el **offset de carácter en el texto del libro**. Es lo que permite que leer y escuchar compartan una sola posición. En los PDF, `pageOffsets` (dónde empieza cada página dentro del texto) traduce entre offset y página en ambos sentidos.

### Apertura de un libro

```
PDF
  → bardo-pdf: abre el documento UNA vez (memoria en archivo temporal)
       · texto por página + título/autor + índice (outline)
  → joinPdfPages: saca encabezados/pies repetidos, une párrafos partidos por el
                  cambio de página, arma fullText + pageOffsets
  → proporción de página + caja de contenido (recorte de márgenes)
  → caché local (SQLite si es chico; archivos en disco si es grande)
  → las páginas se dibujan a demanda, solo las que están en pantalla

EPUB / TXT / DOCX  → parser local → fullText → bloques de texto
```

### Audio

```
fullText → tramos cortos que terminan siempre en fin de oración (synthesisSegments)
  → voice-synthesizer: el motor TTS de Android escribe un WAV por tramo
  → expo-audio lo reproduce; los dos tramos siguientes se preparan por adelantado
  → la posición de reproducción se traduce a offset de carácter → página
```

El reproductor trabaja con archivos, por eso background, pantalla bloqueada, seek y retroceso funcionan igual que con cualquier audio.

### Render de páginas

`PdfPageList` pide cada página a `pdfLocalService`, que mantiene una cola **LIFO con cancelación**: si pasás cien páginas de un tirón se dibuja primero lo que está en pantalla y se descartan los pedidos de las que ya salieron. Las páginas dibujadas se cachean en disco con tope de tamaño.

---

## Estructura del proyecto

```
app/                  pantallas (Expo Router)
  index.tsx             biblioteca
  reader.tsx            lector (páginas o texto) + voz
  book.tsx              "Sobre este libro"
  settings.tsx          ajustes
modules/
  bardo-pdf/            PDF nativo: render (PdfRenderer), texto e índice (Pdfium), recorte
  bardo-archive/        cómics (zip/rar/7z/tar), EPUB (zip + HTML→texto), escaneo SAF, huellas
  voice-synthesizer/    TTS del sistema a archivo WAV
src/
  components/           ui (íconos, filas, hojas, chips), PdfPageList, ReaderBlockCard, BookGridItem…
  hooks/                useReaderController, useAppSettings
  services/             parsers, pdfLocalService, systemTtsService, reproducción, escaneo
  storage/              repositorios SQLite (libros, notas, colecciones, progreso, caché)
  utils/                funciones puras con tests (pageMap, pdfPages, voices, textSearch…)
docs/research/        relevamiento de ReadEra, plan de paridad, comparación y estudio de UX
```

---

## Convenciones

- Comentarios y textos de UI en español.
- La lógica que se puede probar sin dispositivo vive en `src/utils/` como funciones puras con su `.test.ts`.
- Las migraciones de esquema van en `runMigrations` (`src/storage/database.ts`), versionadas con `PRAGMA user_version`.
