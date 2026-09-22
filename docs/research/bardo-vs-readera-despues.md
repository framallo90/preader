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
| **Abrir un libro** | Procesaba el libro ENTERO antes de mostrar la página 1 | **Instantáneo: muestra páginas ya; el texto se prepara de fondo** | Instantáneo, por página |
| Extracción de texto | Server, o local recargando el PDF por cada página | **Local, Pdfium nativo, de fondo** | Local, por página |
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
| Formatos | 4 | **8: PDF, EPUB, TXT, DOCX + cómics CBZ, CBR (RAR 4 y 5), CB7, CBT** (y zip/rar/7z con imágenes) | 14 + ZIP/RAR |
| Cómics | ❌ | **✅ mismo progreso, marcadores, notas, estados y colecciones que un libro** | ✅ |
| Pasar página con volumen | ❌ | ❌ | ✅ |
| Columna única (escaneo doble) | ❌ | ❌ | ✅ |
| Reflow de PDF | ❌ | **✅ "Texto corrido", conserva la posición al cambiar de modo** | ✅ |
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

---

## 6. Apertura instantánea y cómics (2026-09-21)

Probando el release en el teléfono, un libro tardó **más de 10 minutos** en abrir; ReadEra lo abre al instante. Dos causas, las dos mías:

1. **Arquitectura.** Bardo procesaba el libro entero (texto de todas las páginas, limpieza, bloques, recorte) *antes* de mostrar la página 1. Nada de eso hace falta para leer: ReadEra trabaja por página y a demanda.
2. **Un bug cuadrático.** Al unir las páginas se hacía `regex.test(fullText)` y `fullText += …` en cada página: costo lineal en lo acumulado, cuadrático en el libro. En Node (V8) no se notaba; en Hermes —el motor del teléfono— sí. Había otros dos del mismo tipo (oración gigante sin puntos, índice de EPUB).

### Qué cambió

- **PDF: abrir = contar páginas.** Se abre con un documento provisorio (una línea por página) y las páginas se dibujan a demanda. El texto lo prepara `pdfTextPreparationService` de fondo, cediendo el hilo para no trabar el scroll, y sigue aunque salgas del libro. Mientras tanto el lector avisa "Preparando voz y búsqueda… N%".
- **Texto con Pdfium nativo** (`io.legere:pdfiumandroid`) en vez de PDFBox (Java puro). PDFBox se fue del proyecto.
- **Las tres operaciones cuadráticas pasaron a ser lineales.**
- **EPUB:** el zip se lee nativo (`bardo-archive`); antes el archivo entero viajaba en base64 a JavaScript y se descomprimía ahí. JSZip queda solo de respaldo.
- **Caché compacto:** los bloques se guardan como offsets, no como texto duplicado (menos disco y, sobre todo, menos JSON para parsear en cada apertura).
- **Sin copia previa:** un libro de la biblioteca escaneada (content://) se abre donde está. Antes se copiaba entero a la app antes de abrir.
- **Progreso a prueba de todo:** además de bloque y carácter se guardan la **página** y el **largo del texto** sobre el que se midió. Si el texto cambia (provisorio → definitivo, caché borrado, versión nueva del extractor) se retoma por página. De paso se arregló un problema viejo: en páginas sin texto (láminas) la posición saltaba a la última página "vacía".
- **Cómics:** módulo nuevo `bardo-archive`. El contenedor se detecta por contenido (un `.cbr` que en realidad es zip abre igual). Zip local → `java.util.zip`; RAR 4/5, 7z, tar → 7-Zip nativo. Cada página se saca al mostrarse; un archivo *sólido* se descomprime una vez, en orden, y las páginas aparecen a medida que salen. Orden natural ("pagina 2" antes que "pagina 10"), se ignoran `__MACOSX` y ocultos. Para el resto de la app un cómic es un libro por páginas sin texto.

### Medido en el emulador (mismo PDF de 1.500 páginas, 2,6 M de caracteres)

| | Antes | Ahora |
|---|---|---|
| Hasta ver la primera página | ~51 s (extraer 20,7 + unir 29,5 + resto) | **0,11 s** |
| Texto listo para voz/búsqueda | los mismos ~51 s, bloqueando | **~7 s, de fondo** (extraer 4,5 · unir 0,8) |
| Reabrir (con caché) | — | 0,23 s |
| EPUB Quijote (2,1 M caracteres, 142 entradas de índice), primera vez | — | 1,6 s · reabrir 0,3 s |
| Cómic de 24 páginas (cualquier contenedor), importar + abrir | no abría | 0,2–0,4 s · reabrir 0,07 s |

En el teléfono los números absolutos van a ser más altos (CPU más lenta), pero la apertura ya no depende del tamaño del libro.

### Probado

CBZ, CBT, CBR RAR4, CBR RAR5, CBR RAR5 sólido, CB7 (7z sólido) y un zip renombrado a `.cbr`: todos abren, dibujan, generan tapa y retoman en la página donde quedaron. PDF: scroll durante la preparación del texto → al llegar el texto queda en la misma página y la voz arranca desde ahí. Progreso de la versión anterior: se retoma por aproximación de página la primera vez.

### Límites conocidos

- Las páginas de un cómic usan una proporción común (mediana): una doble página se ve entera pero más chica. Sin zoom con los dedos todavía.
- Archivos con contraseña: no se abren (se informa).
- Un webtoon (tira vertical muy larga) se ve reducido.

---

## 7. Segunda ronda de velocidad: acciones innecesarias (2026-09-21, tarde)

Pedido: "la mayor velocidad posible, busquemos las acciones innecesarias". Auditoría de todos los flujos (arranque, Inicio, apertura, páginas, voz, importación) y lo que se encontró:

| Dónde | Qué sobraba | Qué se hizo |
|---|---|---|
| Inicio, cada vez que volvías de un libro | Se re-escaneaban las carpetas por SAF **antes** de mostrar la lista (spinner cada vez), con 2-3 llamadas por archivo, y una consulta de progreso **por libro** | La lista se muestra ya; el escaneo corre de fondo (como mucho cada 2 min) y solo refresca si encontró libros. El listado de carpetas lo hace el módulo nativo en **una consulta por carpeta**. Progreso de todos los libros en una consulta. |
| Abrir un libro cacheado | Se re-detectaban capítulos sobre todo el texto y se reescribían en la base **en cada apertura** | Los capítulos se guardan con el caché. Abrir = leer el caché y mostrar. |
| Abrir (todos) | `touchBook`, portada, guardado del caché y metadata **antes** de mostrar | Todo eso va después del primer dibujo (portada del PDF, 2,5 s después). |
| Abrir PDF/cómic | La página inicial se pedía recién cuando el visor medía su layout | Se pide **antes**, al abrir, al ancho canónico de pantalla: cuando el visor se monta, ya está dibujada. |
| Recorte de márgenes | Corría en el mismo hilo que dibuja las páginas que estás mirando | Hilo y `PdfRenderer` propios. |
| Voz, al apretar play | Primer tramo de ~500 caracteres (~35 s de audio) antes de sonar; en el teléfono, varios segundos | **Grilla anclada donde arrancás**: primer tramo ≤160 caracteres, después 320, después 500. El audio cacheado se reutiliza por rango de texto, no por número de tramo. Las oraciones del libro se calculan una vez; re-anclar cuesta milisegundos. |
| Voz, cada tramo | Se listaban **todos** los archivos del caché de audio (una llamada por archivo) después de cada tramo sintetizado; las voces se re-consultaban al motor cada minuto | Poda cada 25 tramos; voces recordadas 15 min. |
| Visor de texto | Un closure nuevo por párrafo en cada render: el `memo` de la tarjeta no servía y cada tick de la voz re-renderizaba todos los párrafos montados | Callbacks estables por índice; lote inicial de 8 párrafos. |
| EPUB, primera apertura | 17 pasadas de regex en JavaScript por archivo (HTML → texto + normalización) y una segunda conversión completa para ubicar el índice | Conversión **nativa en una pasada** (`HtmlText.kt`) que además devuelve la posición de cada ancla en el texto ya normalizado. Paridad exacta con la versión JS verificada con un test sobre los 33 capítulos del Quijote. |
| Huella de archivo (identidad del libro) | 256 KB en base64 cruzando el puente a JavaScript y SHA-256 en JS | Nativa, **misma fórmula** (los ids no cambian: progreso, notas y colecciones se conservan). |
| Base de datos | `synchronous=FULL` con WAL | `synchronous=NORMAL`: escrituras de progreso más baratas. |
| Detección de capítulos | Solo reconocía encabezados de un libro concreto ("BRAN (1)", herencia de la etapa con IA) y corría dos veces por libro | Genérica ("Capítulo 8", "PARTE II", "Chapter 3", PRÓLOGO…), una sola vez y solo si el libro no trae índice. |

Restos de IA: no queda ninguno en el código. Solo sigue en disco `src/config/apiKeys.ts` (ignorado por git, nadie lo importa): borralo cuando quieras y revocá esas claves.

### Medido en el emulador (después de esta ronda)

| | Antes de hoy | Ronda 1 | **Ronda 2** |
|---|---|---|---|
| PDF 1.500 páginas: primera página | ~51 s | 0,11 s | 0,11 s |
| PDF cacheado: reabrir | — | 0,23 s | 0,2 s |
| EPUB Quijote, primera vez | — | 1,6 s | **0,49 s** (leer+convertir nativo 0,31 · bloques 0,12 · índice 0,02) |
| EPUB Quijote, reabrir | — | 0,3 s | **0,16 s** |
| Cómic: importar + abrir | no abría | 0,2–0,4 s | 0,2–0,4 s |
| Voz: primer sonido | ~1 s por 500 caracteres (teléfono: varios segundos) | igual | **1,5 s por 103 caracteres**; en el teléfono la mejora es proporcional (3-5×) |
| Volver al Inicio con carpetas escaneadas | espera el escaneo entero | igual | inmediato |

Probado además en el emulador: carpeta escaneada por SAF con subcarpeta (3 libros nuevos detectados, copia idéntica deducida por contenido), apertura en el lugar (content://) de PDF con texto, PDF escaneado y cómic 7z sin copiar nada, y la voz con tramos anclados (transiciones cada ~10 s sin cortes ni errores).

---

## 8. Interfaz ordenada e identidad (2026-09-21, noche)

Pedido: "todo ordenado, claro y cómodo; colores llamativos; cambiar el ícono y el nombre del APK". El estudio de uso frente a ReadEra y la estructura final están en **`bardo-ux-vs-readera.md`**. Resumen de lo que cambió:

- **Nombre del APK:** el proyecto Android local todavía decía `pdf-voice-reader` (venía de un `prebuild` anterior al renombre). Se regeneró desde `app.json` (`npx expo prebuild --clean`): el launcher dice **Bardo**, versión **2.0.0**, esquema `bardo://`.
- **Paleta:** índigo `#4F46E5` para lo accionable, ámbar `#F59E0B` para progreso e importancia; fondos `#F5F6FB` / `#0F1117`. La página de lectura sigue calma (blanco / sepia / negro). `src/utils/theme.ts` tiene además `radius` y `space` compartidos.
- **Kit de interfaz** (`src/components/ui.tsx`): `Icon`/`IconButton` (Ionicons; se fueron los emojis), `Chip`, `Section`+`Row`+`RowValue`, `Stepper`, `Sheet`. Botones con ícono.
- **Inicio:** marca + ⚙; tarjeta "Seguir leyendo" con tapa, autor, progreso y [Continuar] [Escuchar]; banda "Reproduciendo ahora"; chips con ícono; carpetas plegables; portadas con etiqueta de formato, tilde de leído y corazón; **+** flotante.
- **Lector:** cabecera con marcador e info; **barra inferior fija** Índice · Buscar · Aspecto · Voz · Pantalla; hojas de Índice (capítulo actual marcado, página o %), Aspecto (tema en chips, letra, atenuar, márgenes) y Voz (velocidad, temporizador, voz, capítulo ±); transporte de audio como píldora clara; play flotante. Desapareció el menú plano de 9 filas.
- **Ajustes:** Lectura → Voz → Biblioteca → Almacenamiento → Acerca de (versión, formatos, "sin conexión").
- **Sobre este libro:** mismo lenguaje (secciones, filas, estrellas ámbar).
- **Arreglos encontrados en el camino:** franja vacía de ~60 px entre la cabecera y el contenido en lector, ajustes y ficha (el SafeAreaView sumaba el inset del sistema encima de la cabecera del navegador); el transporte de audio tapaba el número de página; "0 %" en libros recién empezados.
- **Ícono:** pendiente de Cowork (pedido con especificaciones en el buzón del hub). Sigue el de "PDF reader" hasta que lleguen los archivos.

---

## 9. Mejoras y un bug serio (2026-09-22, madrugada)

**Mejoras:** voz precalentada al abrir (play suena en ~0,8 s en el emulador, antes 1,5 s; en el teléfono la diferencia es mayor); buscar y ordenar la biblioteca; tipografía del modo texto (interlineado, Sans/Serif, justificado); **leer un PDF como texto corrido** conservando la posición al cambiar de modo; el progreso de un PDF en modo texto se muestra en páginas, igual que en la biblioteca.

**Bug encontrado y arreglado — bucle de re-renderizado en el modo texto.** Con el lector abierto en un EPUB (o un PDF como texto), la app consumía **150-180 % de CPU en reposo** y la lista no respondía al dedo. Causa: la lista de párrafos se posiciona en el bloque guardado con `initialScrollIndex`, y sin `getItemLayout` React Native avisa "no pude ir al índice" antes de medir las celdas; el manejador remontaba la lista para reintentar, que volvía a fallar, infinitamente. Venía de antes de hoy: el release que está en el teléfono lo tiene. Arreglo en dos partes: (1) el reintento ya no remonta; (2) `src/utils/blockLayout.ts`: alto estimado por bloque (largo del texto, letra, ancho) corregido con el alto medido al dibujarse, con sumas acumuladas perezosas → `getItemLayout` determinista. Verificado: CPU 0 % en reposo, scroll fluido, salto por índice exacto (60 % → "La tormenta"), posición conservada al cambiar páginas ↔ texto y al reabrir.

**Lección para el emulador:** medir `top -p <pid>` en reposo después de abrir un libro; un bucle así no aparece en typecheck, tests ni capturas.

---

## 10. Ronda de caza de bugs (2026-09-22)

Pasada completa: revisión estática dirigida (servicios/almacenamiento por un lado, pantallas/hooks por el otro) más recorrido de flujos en el emulador con el APK de release. Todo lo de abajo se arregló y se volvió a probar. Al final: tipos estrictos limpios, lint sin problemas, 151 tests, CPU 0 % en reposo dentro del lector y logcat sin errores.

### Lo que rompía de verdad

1. **El salto pedido se perdía en los libros ya cacheados.** Abrir un capítulo, una cita o un marcador desde "Sobre este libro" te dejaba donde habías quedado, no en lo que tocaste. `withPendingJump` se llamaba dos veces y `readerJumpStore.consume` **descarta** el salto en la primera: la segunda leía `null`. Ahora se calcula una sola vez. (Los otros dos caminos ya lo hacían bien; era exclusivo de la rama del caché.)
2. **Cambiar la tipografía te devolvía atrás y guardaba el retroceso.** La lista de texto se remonta cuando cambian letra, interlineado, tipografía, justificado o el ancho de pantalla (rotar), y lo hacía en el bloque de **apertura**, porque el ancla solo se movía en saltos explícitos, nunca con el scroll. Encima, al asentarse, ese retroceso se persistía como progreso. Ahora el punto de montaje sigue al scroll del usuario y, mientras la lista se acomoda, no se guarda nada.
3. **Activar "Reabrir el último libro al iniciar" abría el lector ahí mismo**, encima de Ajustes: el efecto miraba el valor del ajuste, que vive en un contexto compartido con el Inicio (que queda montado debajo). Ahora la decisión se toma una sola vez, cuando los ajustes terminan de leerse.
4. **"Escuchar" desde "Sobre este libro" (abierto desde el lector) apilaba un segundo lector** del mismo libro: dos instancias escribiendo progreso en paralelo y, al cerrar la de arriba, cerraba el PDF que la de abajo seguía usando. Ahora vuelve al lector que ya está abierto y arranca la voz ahí.
5. **Un fallo al guardar tiraba el texto ya extraído de un PDF.** El `catch` que cubre "PDF protegido o dañado" abarcaba también las tres escrituras posteriores: si fallaba cualquiera (disco lleno, el libro borrado mientras se preparaba de fondo), el PDF quedaba marcado "sin texto para la voz" —sin voz, sin búsqueda, sin índice— hasta reabrir la app. Extraer y guardar ahora son cosas distintas.
6. **Pausar durante el hueco entre tramos no se notaba y la voz arrancaba sola.** `pause()` no podía cancelar un avance en vuelo; se alcanza desde la notificación o la pantalla bloqueada, que no pasan por la app. Hay un contador de pausa que el avance mira justo antes de sonar. Del mismo hueco salía otro: **el temporizador de sueño no paraba nada** si el segundo cumplido caía ahí (y no volvía a dispararse nunca).
7. **Un párrafo largo sin puntuación cortaba la voz para siempre.** El motor de Android rechaza texto de más de 4000 caracteres; el troceo corta en fin de oración y, si no hay, en pausas (`, ; :`), pero un texto de OCR sin ninguna de las dos (índices onomásticos, tablas aplanadas) salía entero. Cada reintento armaba el mismo tramo y fallaba igual. Ahora hay un último recurso que parte en el último espacio antes del tope, con tests.
8. **Retomar un libro escuchado hasta el final no sonaba:** el play caía exacto en el final del tramo y dejaba al reproductor en el limbo "terminado sin evento". Se deja un margen, como ya hacía el salto de ±15 s.
9. **La portada se borraba antes de tener la nueva.** Si la extracción de la tapa fallaba (Android purga el archivo temporal), la fila conservaba la ruta vieja y el archivo ya no existía: portada rota. Ahora se escribe al lado y recién al final se reemplaza.
10. **Dos archivos distintos con el mismo nombre podían compartir id** cuando el proveedor no informaba el tamaño: al importar el segundo se pisaba la copia del primero, que desaparecía con su progreso. Si falta el tamaño, ahora se le pregunta al sistema antes de recurrir al nombre.
11. **Agregar una carpeta mientras corría un escaneo la dejaba afuera**: el escaneo en vuelo se compartía sin mirar los argumentos y devolvía el resultado viejo. Ahora se comparte solo si el pedido es el mismo; si no, se encola.
12. **Un libro movido de carpeta no abría más**: el escaneo lo reconocía por huella y cortaba antes de actualizar su ruta. Ahora la corrige.
13. **Dos borrados casi simultáneos se pisaban** en la lista de ocultos y el libro reaparecía solo. Las escrituras se encadenan.
14. **Caché de disco:** los bloques se guardan con el largo del texto con el que se midieron. Si la pareja queda rota (corte entre las dos escrituras), se re-parsea en vez de abrir el libro con todos los párrafos corridos en silencio.
15. **Rechazos sin `catch`** en promesas lanzadas con `void` (guardado de progreso cada 250 ms, resolución de voz, detener el audio, la síntesis que pierde la carrera contra el timeout): en Hermes salen como error rojo. Atrapados.
16. **`ensureChunkLoaded`** no actualizaba el número de tramo en una de sus ramas: tras re-anclar la grilla, el avance podía saltar al tramo equivocado.

### Detalles de interfaz corregidos

- La etiqueta de formato mostraba el **mime completo** en vez de "DOCX" (`VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT`) y "PLAIN" en vez de "TXT".
- A los **cómics** se les ofrecía "Escuchar" en tres lugares (tarjeta de Inicio, menú de mantener apretado y ficha del libro), y llevaba a un lector con la voz deshabilitada.
- El temporizador de sueño mostraba la frase duplicada: "La voz se apaga en **Dormir en** 8:43". El formateador devolvía la frase entera y quien lo mostraba le agregaba otra.
- Tildes que faltaban: "Se borrará…", "Temporizador de sueño", "…después de diez minutos", "versión del caché".
- `/book` sin id se quedaba con el spinner girando para siempre.

### Lo que se probó en el emulador

Importar TXT y DOCX; abrir PDF con texto, PDF escaneado, EPUB, DOCX, TXT y cómic; índice y salto a capítulo (desde el lector y desde la ficha, con caché y sin); marcador; buscar dentro del libro; leer un PDF como texto corrido; voz (reproducir, seguir el texto resaltado, retroceder cruzando tramos, detener); temporizador y selector de voz; probar la voz y salir enseguida; colecciones (crear y asignar); borrar un libro y restaurar ocultos; buscar y ordenar la biblioteca; modo oscuro; pantalla completa; reabrir el último libro al iniciar. En un PDF escaneado, "Índice" y "Voz" quedan deshabilitados y "Buscar" explica por qué: es a propósito.

### Segunda pasada: regresiones que introdujeron los propios arreglos

Revisar el diff con ojo adversario encontró cinco cosas que los arreglos de arriba habían roto o dejado a medias. Todas corregidas y vueltas a probar:

1. **Agregar una carpeta no mostraba un solo libro hasta dos minutos después.** El Inicio limita el escaneo automático a uno cada dos minutos, y el corte no miraba *qué* carpetas eran: si acababas de agregar una en Ajustes, el escaneo se saltaba igual. Ahora, si la lista de carpetas cambió, escanea ya. (Verificado en el emulador: agregar la carpeta y volver al Inicio pasa de 15 a 16 libros al instante.)
2. **El número de tramo podía sobrevivir a la grilla que indexa.** Al cambiar de libro, o al re-extraerse el texto de uno, se rehacía la lista de tramos pero el índice quedaba apuntando a la vieja. Con eso, el retroceso entre tramos desreferenciaba algo que ya no existía, y —peor— lo que el servicio publicaba (rango 0-0) hacía que el lector **guardara el principio del libro encima del progreso real**, o que un final de audio marcara el libro como leído. El índice ahora se resetea junto con la grilla, el retroceso tiene guarda y el lector ignora los rangos vacíos.
3. **Ping-pong de ruta con el mismo archivo en dos carpetas escaneadas.** La relocalización recién agregada reescribía la fila en cada escaneo, alternando entre las dos copias (y cambiando el título mostrado). Ahora solo corrige la ruta si el archivo anterior **ya no está**: eso es una movida; si sigue estando, es una segunda copia y no se toca.
4. **"Restaurar ocultos" había quedado fuera de la cadena de escritura**, así que un borrado en vuelo escribía después del restore y ese libro quedaba oculto igual.
5. **La portada todavía podía perderse.** El borrado de la anterior seguía ocurriendo antes del movimiento final. Ahora la que había se guarda aparte y, si el reemplazo falla a mitad, se la devuelve a su lugar.

Además, un caso latente: el camino de carga del lector consumía el pedido pendiente con la función vieja y **descartaba el pedido de "escuchar"**. Hoy no se notaba porque ese camino no lo usaba, pero quedaba armado para fallar en silencio.
