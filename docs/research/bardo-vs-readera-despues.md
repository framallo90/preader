# Bardo vs ReadEra — después de los cambios

> Segunda comparación, hecha el **2026-09-21** al terminar el plan de [bardo-plan-simplificacion.md](./bardo-plan-simplificacion.md).
> Cómo funciona ReadEra por dentro: [readera.md](./readera.md).

## Estado de verificación — leer primero

| Qué | Estado |
|---|---|
| TypeScript (`npm run typecheck`) | ✅ sin errores |
| Tests (`npm test`) | ✅ 116 pasan (antes 52) |
| APK completo (los dos módulos nativos integrados) | ✅ compila localmente y en EAS |
| **Probado de punta a punta en emulador** (Android 14) | ✅ ver sección 5 |
| Probado en tu teléfono | ❌ pendiente — lo único que el emulador no representa son tus voces y el rendimiento real |

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
| Índice real del documento | ❌ Solo detección | **✅ PDF (outline) y EPUB (nav/NCX)** | ✅ |
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
| Tests | 52 | 116 |
| Dependencias npm | 27 | 22 |
| Pantallas | 8 | 5 |
| Claves de API | 4 | 0 |

**Lectura honesta:** la app no quedó más chica en líneas. Se sacaron unas 1.700 de IA, login y cliente de servidor, y entraron unas 1.700 de funcionalidades. La simplificación es de **arquitectura**: desaparecieron el servidor, la red, las cuentas y las claves.

---

## 5. Ronda de prueba en emulador

Se probó la app real (APK de release) en un emulador Android 14, manejándola por
`adb`, con cuatro libros: un PDF nativo con índice, un **escaneo con OCR de 226
páginas** (*Meditaciones del Quijote*, dominio público), un PDF sin texto y el
**Quijote completo en EPUB** (2,1 millones de caracteres).

### Lo que funcionó

| Prueba | Resultado |
|---|---|
| Arranque y migraciones de base | ✅ |
| Abrir PDF: extracción, páginas, portada, título y autor de los metadatos | ✅ |
| Libro de 226 páginas | ✅ ~10 s la primera vez, 166 MB de memoria total, sin OOM |
| Reabrir un libro ya abierto | ✅ instantáneo, en la página donde quedó |
| Índice real del PDF → capítulos, y salto a un capítulo | ✅ |
| Temas día / sepia / noche sobre la página | ✅ |
| **Voz**: motor local `es-us-x-esc-lstm-embedded`, ~1 s por tramo | ✅ |
| **Voz con la pantalla bloqueada** (90 s): avanza de tramo y sintetiza en segundo plano | ✅ |
| La página sigue a la voz (`🔊 N`) | ✅ |
| Marcador, panel de anotación por página, "Sobre este libro", listas, estrellas, colecciones | ✅ |
| Búsqueda: "catarata" → 1 resultado en la pág. 41, y es la página correcta | ✅ |
| PDF sin texto: abre en modo visual con aviso, sin botón de voz | ✅ |
| EPUB: abre, índice de 142 capítulos, salto a capítulo, voz | ✅ (tras el arreglo) |

### Bugs que aparecieron al probar

Los marcados *previo* ya estaban en `main`, antes de la migración a local.

| Bug | Origen | Estado |
|---|---|---|
| **La voz se cortaba sola tras el primer cambio de tramo.** La guarda de avance nunca se liberaba (se comparaba contra la promesa equivocada) | *previo* | ✅ arreglado y verificado: 8 tramos seguidos, 3 de ellos con la pantalla apagada |
| **En EPUB/TXT/DOCX el progreso se perdía al reabrir**: la lista abría arriba y el detector de scroll guardaba 0% | *previo* | ✅ verificado: reabre en "Capítulo VIII" al 6% |
| Los tramos de voz se cortaban **a mitad de palabra** ("plenitu" \| "d.") | *previo* | ✅ 47% → 97% cierran en fin de oración |
| **1 de cada 4 bloques de texto** apuntaba a otro lugar del libro (mismo defecto: reconstruir + `indexOf`) | *previo* | ✅ 256 → 0 en el libro real |
| **Ningún EPUB de Project Gutenberg abría**: el manifest exigía `id` antes que `href` | *previo* | ✅ |
| El salto a un capítulo lejano no movía la lista de texto | *previo* | ✅ lista anclada en el bloque destino |
| Antes del primer capítulo figuraba el último ("142/142") | *previo* | ✅ |
| El texto del PDF se cortaba a la derecha (ancho de ventana vs. contenedor) | migración | ✅ |
| El teclado tapaba los paneles de anotación y búsqueda y los campos de "Sobre este libro" | migración | ✅ |
| El cartel de error de voz quedaba pegado aunque el reintento anduviera | migración | ✅ |
| Sin la voz del idioma instalada, el mensaje era "código -7" | migración | ✅ ahora dice que hay que instalarla |
| Encabezados mal leídos por el OCR ("MEDITA CIO NES") se leían en voz alta | migración | ✅ comparación tolerante |
| En escaneos: bandas a los costados y sin recorte (papel amarillento) | migración | ✅ mediana de proporciones + umbral relativo al papel |

**Lectura honesta:** la mitad de estos bugs no los introdujo la migración — estaban
desde antes y nunca se habían visto porque no había forma de probar la app sin el
teléfono. Ahora hay emulador y un ciclo de ~40 segundos (compilar, instalar,
probar).

### Lo que queda para tu teléfono

1. **Calidad de la voz.** El emulador confirma que *funciona*; cómo *suena* depende de las voces que tengas instaladas. Ajustes → "Probar"; si suena mal, "Voces" → instalar la de alta calidad del motor de Google.
2. **Rendimiento real**: latencia del primer audio y tiempo de apertura de un libro grande.
3. Tus libros ya abiertos se re-procesan una vez (el caché viejo se descarta). El progreso se conserva; en PDF puede correrse unas líneas porque el texto ahora lo extrae otro motor.

---

