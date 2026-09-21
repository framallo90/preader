# Bardo vs ReadEra — después de los cambios

> Segunda comparación, hecha el **2026-09-21** al terminar el plan de [bardo-plan-simplificacion.md](./bardo-plan-simplificacion.md).
> Cómo funciona ReadEra por dentro: [readera.md](./readera.md).

## Estado de verificación — leer primero

| Qué | Estado |
|---|---|
| TypeScript (`npm run typecheck`) | ✅ sin errores |
| Tests (`npm test`) | ✅ 90 pasan (antes 52) |
| Kotlin de los dos módulos nativos | ✅ compila (`gradlew compileDebugKotlin`) |
| **Probado en un teléfono** | ❌ **No.** Hay código nativo nuevo: hace falta una build nueva para probarlo, y no la lancé sin tu permiso |

Todo lo marcado "hecho" abajo significa **escrito, tipado, con tests donde aplica y compilando**. Ninguna de las piezas nativas (voz, render de PDF, extracción, índice) corrió todavía en un dispositivo. Es lo primero a validar.

---

## 1. Cuadro comparativo

| | Bardo antes | **Bardo ahora** | ReadEra |
|---|---|---|---|
| **Red para leer** | Sí (subir libro, bajar páginas) | **No** | No |
| **Red para escuchar** | Sí (generar audio) | **No** | No |
| **Servidor propio** | Sí (Node + Python) | **No** | No |
| **Claves de API en la app** | 4 | **0** | 0 |
| **Cuentas / login / pagos** | Dormido tras un flag | **No existe** | No |
| **IA** | LLM + voz neural | **Ninguna** | Ninguna |
| **Llamadas `fetch` en el código** | Varias | **Cero** | — |
| Render de PDF | Servidor (PyMuPDF) → PNG por red | **Local, `PdfRenderer`, por página** | Local, MuPDF, por página |
| Extracción de texto | Server, o local recargando el PDF por cada página | **Local, abre el PDF una vez** | Local, por página |
| Libros enormes | Solo con servidor | **Memoria en archivo temporal** | Proceso aparte |
| PDF escaneado (sin texto) | ❌ Error | **✅ Se lee en modo visual** | ✅ |
| Voz | Kokoro neural (nube) | **TTS del sistema, offline** | TTS del sistema, offline |
| Voz con pantalla bloqueada | ✅ | **✅ (se conservó)** | 💰 Premium |
| Retroceder 15 s / seek | ✅ | **✅ (se conservó)** | ❓ |
| Voz según idioma del libro | ❌ Solo español | **✅ Automática** | ✅ |
| Selector de voces + probar | 3 voces fijas | **✅ Las instaladas en el teléfono** | ✅ |
| Saltear encabezados repetidos | ❌ | **✅** | 💰 Premium |
| La voz mueve la página | ✅ | ✅ | ✅ |
| Temporizador de sueño | ✅ | ✅ | ✅ |
| Marcadores | ❌ | **✅** | ✅ |
| Citas y notas | ❌ | **✅ por párrafo o página** | ✅ por selección exacta |
| Pantalla "Sobre este libro" | ❌ | **✅** | ✅ "About Document" |
| Reseña con estrellas | ❌ | **✅** | ✅ |
| Listas Para leer / Leído / Favorito | ❌ | **✅** | ✅ |
| Colecciones (N:N) | ❌ | **✅** | ✅ |
| Índice real del documento | ❌ Solo detección | **✅ Outline del PDF + detección** | ✅ |
| Buscar en el libro | ❌ | **✅ sin tildes/mayúsculas** | ✅ con stemming |
| Temas de lectura | Claro / oscuro | **Día / sepia / noche, también en PDF** | 5 temas |
| Recorte de márgenes | ❌ | **✅ automático** | ✅ |
| Brillo bajo el mínimo | ❌ | **✅ atenuador** | ✅ |
| Carpetas excluidas del escaneo | ❌ | **✅** | ✅ |
| Biblioteca completa | Últimos 20 | **Todos + filtros** | Todos + filtros |
| Identidad por contenido | ✅ | ✅ | ✅ (`doc_sha`) |
| Formatos | 4 | 4 | 14 + ZIP/RAR |
| Pasar página con volumen | ❌ | ❌ | ✅ |
| Columna única (escaneo doble) | ❌ | ❌ | ✅ |
| Reflow de PDF | ❌ | ❌ | ✅ |
| Vocabulario personal | ❌ | ❌ | ✅ |
| Modo infantil / pantalla dividida / sync Drive | ❌ | ❌ | ✅ |

---

## 2. Qué se hizo del plan

### Quitar — completo

| Qué | Resultado |
|---|---|
| Chat, contexto por capítulo, personajes (LLM) | Borrado. Tablas `chapter_context` y `characters` eliminadas por migración |
| Login, Supabase, suscripción, `PERSONAL_MODE` | Borrado, con la carpeta `supabase/` y `SUPABASE_SETUP.md` |
| Voz en la nube (fal.ai / Kokoro) | Borrada |
| Backend propio (`server/`) y su cliente | Borrado |
| `.easignore` | Borrado: existía solo para subir las claves a EAS |
| Dependencias | 27 → **22**: fuera `@supabase/supabase-js`, `react-native-url-polyfill`, `expo-secure-store`, `expo-pdf-text-extract`, `expo-speech` |

### Cambiar — completo

| Qué | Cómo quedó |
|---|---|
| **Voz** | Módulo nativo `voice-synthesizer`: el motor TTS de Android escribe un WAV por tramo. **Solo se cambió el generador**: el reproductor sigue trabajando con archivos, así que pantalla bloqueada, seek y retroceso se conservaron. Tramos de ~500 caracteres (antes 1.500) para que el primer audio salga rápido, con dos tramos preparados por adelantado |
| **Texto del PDF** | Módulo nativo `bardo-pdf`: abre el documento **una sola vez** con memoria en archivo temporal. El extractor anterior recargaba el PDF entero en memoria por cada página — esa era la lentitud y el motivo del servidor |
| **Páginas** | `PdfRenderer` de Android, a demanda, con cola LIFO y cancelación: si pasás cien páginas de un tirón se dibuja primero la que estás mirando |
| **Servidor** | Apagado en el código. No queda ninguna llamada de red |

### Agregar — hecho

Anotaciones · "Sobre este libro" · listas · colecciones · reseña · índice real · búsqueda · temas · atenuador · recorte de márgenes · carpetas excluidas · PDF escaneados · biblioteca completa con filtros.

### No hecho, y por qué

| Qué | Motivo |
|---|---|
| **Pasar página con botones de volumen** | Interceptar esas teclas exige tocar la `MainActivity` (un config plugin). No se puede desde un módulo Expo común |
| **Apertura instantánea del primer PDF grande** | Bardo necesita el texto completo para que voz, búsqueda y progreso compartan una posición; ReadEra no. La **primera** apertura de un libro grande muestra "Leyendo el libro… N de M páginas"; las siguientes sí son instantáneas (caché). Mejorable mostrando páginas mientras el texto se extrae de fondo |
| **Aviso de posición obsoleta** | No aplica: Bardo identifica por contenido, así que un archivo modificado es otro libro |
| **Índice de EPUB** | Solo se agregó el del PDF; en EPUB sigue la detección sobre el texto |
| Columna única, reflow, vocabulario, modo infantil, sync, más formatos | Fuera del plan por decisión |

---

## 3. Dos mejoras que ReadEra cobra y Bardo ahora da

1. **Escuchar con la pantalla bloqueada.** En ReadEra es Premium. En Bardo se conservó porque la voz se sintetiza a archivo y la reproduce `expo-audio`, que ya corría en background.
2. **Saltear encabezados y pies repetidos.** En ReadEra es Premium (*"the ability to skip reading headers and page numbers"*). En Bardo, las líneas que se repiten arriba o abajo de muchas páginas se detectan y se sacan del texto que lee la voz.

Y una tercera, propia: **un párrafo que continúa en la página siguiente se une con un espacio** en vez de un salto de párrafo. Antes la voz hacía una pausa falsa en cada cambio de página — en un libro de 600 páginas, 600 pausas.

---

## 4. Números

| | Antes | Ahora |
|---|---|---|
| Código de la app (`app/` + `src/`, sin tests) | 9.099 líneas | 9.107 líneas |
| Código de servidor (`server/` + `supabase/`) | 1.033 líneas | 0 |
| Módulos nativos propios | 0 | 811 líneas |
| **Total del sistema** | **10.132** | **9.918** |
| Tests | 52 | 90 |
| Dependencias npm | 27 | 22 |
| Pantallas | 8 | 5 |
| Claves de API | 4 | 0 |

**Lectura honesta:** la app no quedó más chica en líneas. Se sacaron unas 1.700 de IA, login y cliente de servidor, y entraron unas 1.700 de funcionalidades. La simplificación es de **arquitectura**: desaparecieron el servidor, la red, las cuentas y las claves.

---

## 5. Qué hay que validar en el teléfono

Hace falta una build nueva (`eas build --profile preview --platform android`) porque cambió código nativo. En este orden:

1. **Abrir un PDF con texto** — que extraiga, muestre páginas y guarde en caché. Reabrirlo tiene que ser instantáneo.
2. **Voz** — que suene, que la página siga a la voz, y **que siga sonando con la pantalla bloqueada**. Es la pieza con más riesgo.
3. **Latencia del primer audio** — debería ser de 1 a 3 segundos. Si es más, bajar `DEFAULT_MAX_CHUNK_CHARS` en `src/utils/synthesisSegments.ts`.
4. **Calidad de voz** — Ajustes → "Probar". Si suena mal: botón "Voces" → instalar la voz de alta calidad del motor de Google.
5. **Libro grande** (500+ páginas) — que no se quede sin memoria al extraer.
6. **PDF escaneado** — que abra en modo visual con el aviso de "sin texto para la voz".
7. **Recorte de márgenes** — que no corte texto. Si algún libro queda mal, se apaga desde el menú del lector.
8. **Marcador, cita, nota, búsqueda** y el salto desde "Sobre este libro".

Tus libros ya abiertos se van a re-procesar una vez (el caché viejo no tiene el mapa de páginas). El progreso se conserva, aunque puede correrse unas líneas porque el texto ahora lo extrae otro motor.

---

## 6. Cabos sueltos

- **`src/config/apiKeys.ts`** sigue en disco con las claves viejas. Ya nada lo importa. No lo borré porque está fuera de git y no se podría recuperar. Si no vas a usar más esas claves, conviene borrarlo **y revocarlas** en Hugging Face, fal.ai y OpenAI: quedaron embebidas en los APK anteriores.
- **El servicio `bardo-api` en tu servidor** probablemente siga corriendo. La app ya no lo usa; podés apagarlo cuando quieras.
- **Punto de restauración:** `git stash list` → `pre-simplificacion`. Tiene tu trabajo sin commitear tal como estaba antes de empezar. No hice ningún commit.
