# Bardo

Lector y narrador de libros para Android. Abrí un PDF, EPUB, TXT, DOCX o un cómic y leelo o escuchalo con la voz del sistema mientras ves la página real: la narración sabe en qué página va, resalta la palabra que está leyendo y pasa la página por vos. Todo funciona en el teléfono, sin servidor, sin cuenta y sin conexión.

*(English version: [README.en.md](./README.en.md))*

| Biblioteca | Lector con voz | Personajes | Estadísticas |
| :---: | :---: | :---: | :---: |
| ![Biblioteca](docs/screenshots/biblioteca.png) | ![Lector con la palabra resaltada](docs/screenshots/lector-voz.png) | ![Personajes sin spoilers](docs/screenshots/personajes.png) | ![Estadísticas](docs/screenshots/estadisticas.png) |

## Funciones

**Lectura**
- PDF dibujado tal cual es, al ancho de la pantalla, con scroll continuo o paso de página, zoom con los dedos y recorte automático de márgenes.
- EPUB, TXT y DOCX en modo texto, con tipografía, tamaño, interlineado y márgenes ajustables.
- Cómics CBZ, CBR, CB7 y CBT.
- Cuatro temas: día, sepia, noche y noche cálida, aplicados también a las páginas del PDF.
- Índice real del archivo o detectado en el texto, mapa del libro con capítulos y anotaciones, y búsqueda sin distinguir tildes.

**Voz**
- Narración con el motor de texto a voz de Android, offline. Sigue con la pantalla bloqueada, con controles en la notificación.
- La palabra que suena se resalta sobre la página y la vista pasa de página sola.
- Velocidad y voz por libro, diccionario de pronunciación, anuncio de capítulo y temporizador de sueño.

**Biblioteca y anotaciones**
- Escaneo de carpetas, portadas reales, listas (para leer, leído, favoritos), colecciones y sagas por carpeta.
- Marcadores, citas y notas con salto directo; exportación a Markdown y cita como imagen para compartir.
- Personajes sin spoilers: los nombres que más aparecen hasta donde leíste, sin IA.
- Estadísticas de tiempo leído y escuchado, racha y meta anual.
- Exportar e importar todos los datos en un archivo JSON.

## Stack

| Capa | Tecnología |
| --- | --- |
| App | React Native 0.83, Expo SDK 55, TypeScript, Expo Router |
| Datos | SQLite (`expo-sqlite`) con migraciones versionadas |
| PDF | Módulo nativo propio `bardo-pdf`: `PdfRenderer` de Android y Pdfium (texto, índice, coordenadas) |
| Cómics y EPUB | Módulo nativo propio `bardo-archive`: `java.util.zip` y 7-Zip (RAR, 7z, tar), conversor HTML a texto |
| Voz | Módulo nativo propio `voice-synthesizer`: `TextToSpeech.synthesizeToFile` |
| Reproducción | `expo-audio` en segundo plano |
| Teclas de volumen | Módulo nativo propio `bardo-keys` |
| DOCX | `mammoth` |
| Tests | Vitest |

## Requisitos

- Node.js 20 o superior
- JDK 17
- Android SDK con `platform-tools` y un dispositivo o emulador con Android 7.0 (API 24) o superior

La app tiene módulos nativos propios, así que no corre en Expo Go.

## Puesta en marcha

```bash
npm install
npx expo run:android
```

El primer comando instala las dependencias. El segundo genera el proyecto Android si no existe, compila e instala la app en el dispositivo conectado. No hay claves ni servicios que configurar.

Verificación:

```bash
npm run typecheck
npm run lint
npm test
```

APK de release:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

El resultado queda en `android/app/build/outputs/apk/release/app-release.apk`. Después de cambiar algo dentro de `modules/` hay que volver a compilar.

## Arquitectura

Todo el estado de lectura usa una sola unidad: el **offset de carácter dentro del texto del libro**. Progreso, voz, búsqueda y anotaciones apuntan al mismo lugar, y por eso leer y escuchar comparten una posición. En los PDF, `pageOffsets` (dónde empieza cada página dentro del texto) traduce entre offset y página en los dos sentidos.

```
archivo ──► parser (por formato) ──► ParsedDocument ──► caché local ──► lector
                                     texto + bloques        SQLite o disco     │
                                     + capítulos                               ├─► PdfPageList: páginas a demanda (bardo-pdf)
                                     + pageOffsets                             └─► voz: tramos ──► WAV (voice-synthesizer) ──► expo-audio
                                                                                          posición de audio ──► offset ──► página
```

- **Apertura instantánea.** Un PDF muestra su página en el acto; el texto para la voz y la búsqueda se prepara de fondo. Reabrir un libro procesado lee el caché, no el archivo.
- **Páginas a demanda.** El lector pide cada página a una cola LIFO con cancelación: lo que está en pantalla se dibuja primero y lo que ya salió se descarta. Las páginas dibujadas se cachean en disco con tope de tamaño.
- **Voz por archivos.** El texto se corta en tramos que terminan en fin de oración. El motor del sistema escribe un WAV por tramo, con dos preparados por adelantado, y la posición de reproducción se traduce a offset de carácter. Trabajar con archivos es lo que permite segundo plano, pantalla bloqueada y retroceso.

Modelo de datos:

```
Book  ── status · favorite · rating · review · orderIndex
 ├── Chapter            índice del archivo o detectado del texto
 ├── Note               marcador | cita | nota
 ├── ReadingProgress    offset de carácter, porcentaje y página
 ├── ReadingStats       segundos leídos y escuchados por día
 └── Collection (N:N)
```

## Estructura del proyecto

```
app/                    pantallas (Expo Router)
  index.tsx               biblioteca
  reader.tsx              lector (páginas o texto) y voz
  book.tsx                ficha del libro
  notes.tsx · stats.tsx · pronunciation.tsx · settings.tsx
src/
  components/             piezas de interfaz: PdfPageList, ReaderBlockCard, BookMapBar, ui
  hooks/                  useReaderController, useAppSettings
  services/               parsers, PDF local, voz, escaneo de biblioteca, respaldo
  storage/                esquema, migraciones y repositorios SQLite
  utils/                  lógica pura con tests
  types/                  contratos entre capas
modules/
  bardo-pdf/              render, texto, índice y coordenadas de PDF (Kotlin, Pdfium)
  bardo-archive/          cómics, EPUB, escaneo SAF y huellas de archivo (Kotlin, 7-Zip)
  voice-synthesizer/      texto a voz a archivo WAV (Kotlin)
  bardo-keys/             captura de las teclas de volumen (Kotlin)
docs/
  research/               decisiones de diseño, auditorías y mediciones
  brand/                  identidad visual y logos anteriores
  screenshots/            capturas para este README
  ops/                    procedimientos operativos
  hub/                    notas de coordinación del proyecto
assets/                   íconos, splash y tipografía (Lora, licencia OFL)
```

La carpeta `android/` no está en el repositorio: se genera con `expo prebuild` a partir de `app.json` y los módulos.

## Calidad

- TypeScript estricto y ESLint sin advertencias.
- 408 tests con Vitest sobre funciones puras: partición del texto, mapeo de páginas, progreso, capítulos, estadísticas y respaldo. Cada archivo de `src/utils/` tiene su `.test.ts` al lado.
- Un test JVM para el conversor HTML a texto del módulo `bardo-archive`.
- Migraciones de esquema versionadas con `PRAGMA user_version`; una migración que falla no sube la versión y se reintenta al siguiente arranque.
- Rendimiento medido antes y después de cada cambio grande (arranque en frío y memoria con el lector narrando).

## Estado

Versión 2.0.0, en pruebas en dispositivo. La publicación en Google Play está planificada.
