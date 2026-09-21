# Bardo → simple y rápido como ReadEra: qué quitar, qué cambiar, qué agregar

> Objetivo: que Bardo se comporte como ReadEra — abrir un libro y leer/escuchar al instante, sin red, sin cuentas, sin IA.
> Basado en el código actual de Bardo (8.029 líneas en `app/` + `src/`) y en el análisis del APK de ReadEra ([readera.md](./readera.md)).
> Fecha: 2026-09-21.

## La idea en una línea

ReadEra es rápido por una sola razón: **nada de lo que hacés al leer pasa por la red, y nada se procesa antes de que lo necesites.** Su API de motor es por página (`pageOpenJni`, `pageTextJni`, `pageRenderJni`): abre el archivo y renderiza la página que estás mirando, nada más.

Bardo hoy hace lo contrario en tres lugares: sube el libro a un servidor, extrae el texto del libro entero antes de abrirlo, y genera el audio por red. **Esos tres son toda la lentitud.** El resto del plan es limpieza.

---

## 1. QUITAR — borrado puro, no toca la lectura

| Qué | Archivos | Líneas | Qué más se va | Riesgo |
|---|---|---|---|---|
| **Chat con el libro** | `app/chat.tsx` | 367 | — | Ninguno |
| **Contexto por capítulo (LLM)** | `app/chapter-context.tsx`, `src/services/claudeService.ts`, `src/storage/chapterContextRepository.ts` | 510 | Tabla `chapter_context`, `HF_TOKEN` | Ninguno |
| **Personajes (LLM)** | `src/storage/characterRepository.ts` | 130 | Tabla `characters` | Ninguno |
| **Login** | `app/login.tsx`, `src/services/authService.ts`, `src/config/supabase.ts` | ~320 | Deps `@supabase/supabase-js`, `react-native-url-polyfill`, `expo-secure-store` | Ninguno |
| **Suscripción / premium** | `app/subscription.tsx`, `src/services/premiumService.ts`, `src/config/appMode.ts` | ~300 | Flag `PERSONAL_MODE` y todas sus ramas; carpeta `supabase/`; `SUPABASE_SETUP.md` | Ninguno |
| **Referencias colgantes** | `app/_layout.tsx` (19 refs), `app/settings.tsx` (13), `app/reader.tsx` (4) | — | Guards de auth en el layout, secciones de cuenta/IA en Ajustes, botones de chat/contexto en el lector | Bajo |

**Resultado:** ~1.600 líneas menos (20% de la app), 3 dependencias nativas menos, 2 tablas menos, 1 clave de API menos, 4 pantallas menos. Ajustes queda en lo que importa: lectura, voz, biblioteca.

`expo-linking` no se importa en ningún lado pero **no hay que sacarlo**: es peer dependency de `expo-router`.

---

## 2. CAMBIAR — sacar la red del camino caliente

Acá está la velocidad. Ordenado de menor a mayor esfuerzo.

| Hoy en Bardo | Como lo hace ReadEra | Cambio | Qué ganás | Qué perdés | Esfuerzo |
|---|---|---|---|---|---|
| **TTS por red**: Kokoro en fal.ai, genera audio, lo cachea en `tts-cache`, lo reproduce con `expo-audio` | TTS del sistema Android, una oración por utterance, `onStart`/`onDone` mueven la posición | Pasar a `expo-speech` (**ya está instalado y sin usar**). Hablar oración por oración; en cada `onDone` avanzar el offset | Escuchar arranca **al instante**, sin red, gratis, sin caché de audio, sin `FAL_KEY`. Se van `openaiTtsService.ts` (246) y buena parte de `documentAudioPlaybackService.ts` (542) y `synthesisSegments.ts` | **La calidad de voz.** Kokoro suena mucho mejor que el TTS de Android. Es la única quita de todo el plan que cuesta algo real | 🟡 |
| **Texto del libro entero** extraído antes de abrir (por eso el parser local tiene techo de páginas) | Texto **por página, a demanda** (`pageTextJni`) | Extraer con `expo-pdf-text-extract` por rango de páginas, solo alrededor de donde estás leyendo | Abrir un libro de 1.000 páginas tarda lo mismo que uno de 10. Desaparece el techo de memoria, que era la razón de existir del servidor | La detección de capítulos sobre el texto completo pasa a correr en segundo plano, o se reemplaza por el índice del PDF | 🔴 |
| **Páginas renderizadas por el servidor** (PyMuPDF → PNG → red → `expo-image`) | Render nativo local, por página | Renderizar en el teléfono con un visor nativo (`react-native-pdf`, basado en Pdfium; entra en la dev build que ya usás) | Offline total, zoom real, cero espera de red al pasar página | — | 🔴 |
| **Backend propio** (`server/`, 602 líneas + `bardoServerService.ts`, 203) | No existe | Cuando los dos cambios de arriba estén, el servidor no tiene trabajo: se apaga | Cero infraestructura que mantener, cero upload al importar, `BARDO_SERVER_URL` y `BARDO_TOKEN` afuera. De paso desaparece el tema de la licencia AGPL de PyMuPDF | Los formatos extra que PyMuPDF daba gratis (MOBI, FB2, CBZ) | 🟢 una vez hechos los otros |

### Dos advertencias honestas sobre el TTS del sistema

1. **Pantalla bloqueada.** Hoy Bardo reproduce archivos de audio con `expo-audio`, que sigue sonando en background. `expo-speech` no trae servicio en primer plano; con el teléfono bloqueado Android puede suspender el JS y cortar la cola de oraciones. ReadEra lo resuelve con un `SpeechService` nativo de tipo `mediaPlayback` (está en su manifest). **Hay que probarlo en el dispositivo antes de borrar el camino de Kokoro**; si se corta, hace falta un módulo nativo chico.
2. **Es reversible si se hace bien.** Si el reproductor queda detrás de una interfaz (`speak(texto) → onDone`), Kokoro puede quedar como motor alternativo apagado en vez de borrarse.

### Por qué el orden importa

El servidor existe porque el teléfono no podía con PDFs grandes. No podía porque extraía todo el libro de una vez. **Si la extracción pasa a ser por página, el problema que justificaba el servidor deja de existir.** Por eso el servidor es lo último que se apaga, no lo primero.

---

## 3. AGREGAR — lo que ReadEra tiene y Bardo no

Todo esto es local (SQLite + pantallas). Nada agrega red ni dependencias pesadas.

| Feature | Cómo (copiando a ReadEra) | Esfuerzo |
|---|---|---|
| **Citas, notas y marcadores** | Una sola tabla `notes` con `note_type` como discriminador + `note_page`, `note_index`, `note_body`, `note_mark`. Selección de texto → citar / nota / copiar | 🟡 |
| **Pantalla "Sobre este libro"** | Una vista por libro: índice + marcadores + citas + notas + reseña. Ocupa el lugar que dejan chat y contexto | 🟡 |
| **Índice real del documento** | Leer el outline del PDF/EPUB (lo que ReadEra saca con `getOutlineJni`). `chapterDetector.ts` queda como plan B cuando el archivo no trae índice | 🟡 |
| **Listas: Para leer / Leídos / Favoritos** | Una columna de estado en `books` + filtro en la biblioteca | 🟢 |
| **Colecciones** | Tablas `colls` + `docs_to_colls` (N:N) | 🟡 |
| **Búsqueda dentro del libro** | Buscar sobre el texto por página ya extraído | 🟡 |
| **Temas de lectura** | Día / noche / sepia / consola. Hoy solo hay oscuro | 🟢 |
| **Temporizador de sueño** | Timer sobre la cola de voz | 🟢 |
| **Pasar página con botones de volumen** | Listener de teclas en el lector | 🟢 |
| **Brillo por debajo del mínimo del sistema** | Overlay negro semitransparente sobre el lector | 🟢 |
| **Carpetas excluidas del escaneo** | Lista de exclusiones en `libraryScanService.ts` | 🟢 |
| **Aviso de posición obsoleta** | Si la huella del archivo cambió, preguntar antes de saltar (su `doc_outdated_position`) | 🟢 |
| **Reseña con estrellas** | Dos columnas en `books` | 🟢 |
| **Recorte de márgenes / columna única** | Con visor nativo: zoom + recorte por página | 🔴 después del render local |

**Lo que no agregaría ni para igualar:** DJVU, CHM, RTF, ODT, pantalla dividida, modo infantil, sync con Drive, vocabulario personal, Android Auto. Para uso propio no resuelven ningún problema tuyo y todos suman complejidad.

---

## 4. MANTENER — lo que Bardo ya hace bien

| Qué | Por qué |
|---|---|
| **Huella de contenido** (`documentId.ts`, SHA-256 de 256 KB + tamaño) | ReadEra hace lo mismo con `doc_sha`. Está bien resuelto |
| **Escaneo de carpetas** (`libraryScanService.ts`) | Es el modelo de ReadEra: leer el archivo donde está |
| **SQLite local** (`expo-sqlite`) | Igual que ReadEra, que usa SQLite crudo |
| **La voz mueve la página y un chip te devuelve a ella** | ReadEra lo tiene; es el comportamiento correcto |
| **Scrubber de páginas, pantalla completa, rotación** | Paridad con ReadEra |
| **Parsers de EPUB / TXT / DOCX** (`jszip`, `mammoth`) | Ya son locales y no dependen del servidor |
| **Tests de funciones puras** (Vitest) | Red de seguridad para todo este refactor |

---

## 5. El antes y el después

| | Bardo hoy | Bardo simplificado | ReadEra |
|---|---|---|---|
| Red necesaria para leer | Sí (primer procesado, páginas) | **No** | No |
| Red necesaria para escuchar | Sí (generar audio) | **No** | No |
| Claves de API embebidas | 4 (HF, fal, server URL, token) | **0** | 0 |
| Servidor propio | Sí | **No** | No |
| Cuentas / login / pagos | Código dormido tras un flag | **No existe** | No |
| IA | LLM + TTS neural | **Ninguna** | Ninguna |
| Tiempo hasta la primera página | Upload + extracción completa | **Inmediato** | Inmediato |
| Tiempo hasta que suena la voz | Generación por red | **Inmediato** | Inmediato |
| Anotaciones | No | **Sí** | Sí |
| Pantallas | 8 | **5** (biblioteca, lector, sobre el libro, ajustes, layout) | — |

---

## 6. Orden sugerido

1. **Borrado** (sección 1). Un día, riesgo cero, y deja el código más chico para todo lo que sigue.
2. **TTS del sistema**, detrás de una interfaz, probando pantalla bloqueada en el teléfono.
3. **Anotaciones + "Sobre este libro" + listas.** Es lo que más se nota en el uso diario.
4. **Texto por página.** El cambio estructural: el modelo de posición pasa de offset en el libro entero a página + offset dentro de la página.
5. **Render nativo local.**
6. **Apagar el servidor.**

Los pasos 1 a 3 no dependen de los demás y ya dejan a Bardo más simple y más rápido de escuchar. Los pasos 4 a 6 son los que lo vuelven igual a ReadEra en velocidad de apertura, y conviene encararlos juntos porque comparten el rediseño de la posición.
