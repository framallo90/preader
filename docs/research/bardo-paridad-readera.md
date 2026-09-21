# ¿Podemos igualar a ReadEra? — plan de paridad para Bardo

> Complemento de [readera.md](./readera.md), que describe cómo funciona ReadEra por dentro.
> Este doc responde una sola pregunta: **qué de ReadEra es replicable en Bardo, con qué esfuerzo, y qué no vale la pena.**
> Contexto: uso personal, no distribución pública.

---

## 1. La respuesta corta

**Sí, se puede igualar casi todo lo que importa — y en dos puntos ya estás mejor.** Pero no copiando su arquitectura, sino aprovechando dos cosas que a ellos les están prohibidas y a vos no.

### Ventaja 1: para uso propio, el copyleft no se dispara

Toda la arquitectura de ReadEra —motores como procesos separados, IPC por named pipes, un puente JNI de 54 métodos— **existe por una sola razón**: tres de sus cinco motores son **AGPL** y ellos venden una app cerrada. Si linkearan MuPDF adentro, tendrían que abrir todo el código.

**Vos no distribuís.** La GPL y la AGPL se disparan con la *distribución*; usar software GPL para vos mismo no genera ninguna obligación. Podés linkear MuPDF, CoolReader o lo que quieras directo, sin el baile de procesos.

⚠️ **Un matiz que sí te aplica, y es real:** tu backend usa **PyMuPDF, que es AGPL-3.0**. La AGPL cierra justamente el hueco de la red: si *otros usuarios* interactúan con tu servidor, estás obligado a ofrecerles el código fuente. Mientras seas el único usuario, no hay problema. Si algún día abrís Bardo a terceros, esto se vuelve una decisión real: publicar el código bajo AGPL, o licencia comercial de Artifex. **No es un problema hoy; es un problema el día que dejes de ser el único usuario.** Conviene saberlo ahora y no después.

### Ventaja 2: ya tenés lo que a ellos les falta

Bardo tiene voces neurales (Kokoro) y una capa de IA. ReadEra usa el TTS del sistema Android y no tiene nada de IA 🔬. Eso no lo van a agregar: les rompería el modelo de costo marginal cero del que vive la empresa.

### El ajuste de expectativas

El relevamiento del APK me obligó a corregir algo que te dije antes: **la sincronización audio↔página no es un diferencial de Bardo.** ReadEra la tiene, y a nivel de motor (`speechRectJni` devuelve las coordenadas de lo que se está leyendo). Lo que sí te queda como diferencial es **la calidad de la voz y la capa de IA**, no la sincronización en sí.

---

## 2. ¿Hacía falta el APK?

Ya lo tenés analizado, así que la pregunta es retrospectiva, pero vale la respuesta porque explica qué tipo de cosas conviene mirar:

**Para saber qué hace ReadEra: no hacía falta.** El sitio y las fichas de store cubren el 80%.

**Para saber cómo está hecho y qué esconde: hizo toda la diferencia.** El APK reveló cinco cosas que ninguna fuente pública decía:

1. Los motores son **ejecutables**, no librerías (probado por `PT_INTERP` en el header ELF).
2. Existe un **sistema de vocabulario personal** completo — invisible en todo el material público.
3. El TTS **resalta sobre la página** lo que va leyendo.
4. El paywall gatea **12 cosas**, no las 6 que publican.
5. El modelo de datos exacto: `docs` con `doc_sha`, una sola tabla `notes` con discriminador, `coll_child` para modo infantil.

Y me hizo corregir cuatro conclusiones que tenía mal. **La lección práctica: el material público de un competidor sirve para el "qué", nunca para el "cómo", y a veces miente por omisión sobre el "qué" también.**

Lo que el APK **no** da: está ofuscado con R8 (paquetes `p0`, `n1`, `a5`), así que la lógica de negocio no es legible. Se ven nombres de clases del manifest, strings, SQL, símbolos nativos y recursos — que resultó ser suficiente.

---

## 3. El atajo que cambia el plan: PyMuPDF ya cubre casi todos los formatos

Tu backend ya corre **PyMuPDF**, que es MuPDF — **el mismo motor que usa EraPDF**. Y MuPDF abre bastante más que PDF:

> Formatos soportados por PyMuPDF: **PDF, XPS, EPUB, MOBI, FB2, CBZ, SVG, TXT, MD, imágenes** (+ DOCX/XLSX/PPTX por conversión).

Comparado con ReadEra:

| Formato | ReadEra | Bardo hoy | Vía PyMuPDF en tu server |
|---|---|---|---|
| PDF | EraPDF | ✅ | ✅ ya |
| EPUB | EraEPUB (CoolReader) | ✅ parser propio | ✅ disponible |
| TXT | EraEPUB | ✅ | ✅ |
| DOCX | EraEPUB (Antiword) | ✅ mammoth | ✅ por conversión |
| **MOBI / AZW** | EraMOBI | ❌ | ✅ **gratis, ya lo tenés** |
| **FB2** | EraEPUB | ❌ | ✅ **gratis** |
| **CBZ** (cómics) | EraComic | ❌ | ✅ **gratis** |
| CBR (RAR) | EraComic | ❌ | ⚠️ necesita unrar aparte |
| DJVU | EraDjVu | ❌ | ❌ MuPDF no lo hace |
| CHM / RTF / ODT | EraEPUB | ❌ | ❌ |

**Pasás de 4 a 7 formatos casi sin escribir código nuevo** — es abrir el documento con `fitz.open()` en vez de ramificar por extensión. DJVU y CHM son los únicos huecos reales, y para tu uso (sagas, libros densos) no importan.

---

## 4. Tabla de paridad feature por feature

Esfuerzo: 🟢 trivial (horas) · 🟡 medio (días) · 🔴 grande (semanas) · ⛔ no vale la pena

### Ya lo tenés o es trivial

| Feature de ReadEra | Cómo se hace en Bardo | Esfuerzo |
|---|---|---|
| Identidad por contenido | Ya: SHA-256 de 256 KB + tamaño. Ellos usan `doc_sha`. **Empate.** | ✅ hecho |
| Render de página real | Ya: `render_page.py` con PyMuPDF | ✅ hecho |
| Extracción de texto + offsets | Ya: `extract.py` + mapa de offsets | ✅ hecho |
| TTS con seguimiento de página | Ya, y con voz neural | ✅ hecho |
| Posición única leer/escuchar | Ya: offset de carácter compartido | ✅ hecho |
| Modo oscuro | Ya | ✅ hecho |
| Listas To Read / Have Read / Favorites | Tres booleanos en `bookRepository` + filtro en la biblioteca | 🟢 |
| Índice / TOC | `doc.get_toc()` de PyMuPDF, ya tenés el pipeline | 🟢 |
| Búsqueda en el documento | `page.search_for()` → devuelve rects, igual que `searchRectJni` | 🟢 |
| Modo infantil | Copiá su idea: flag `coll_child` en colecciones + passcode | 🟢 |
| Temporizador de sueño | Timer sobre el player de `expo-audio` | 🟢 |
| Botones de volumen para pasar página | `expo-keep-awake` + listener de teclas | 🟢 |

### Vale mucho y cuesta poco — lo que yo haría primero

| Feature | Cómo | Esfuerzo |
|---|---|---|
| **Citas, notas y marcadores** | **Copiá su esquema tal cual**: una tabla `notes` con `note_type` como discriminador, más `note_body`, `note_page`, `note_index`, `note_mark`. Es el hueco más grande de Bardo frente a cualquier lector serio. | 🟡 |
| **Pantalla "Sobre este libro"** | Una vista por libro que junte TOC + capítulos + progreso + citas + notas + contexto IA + chat. Es el mejor patrón de UX de ReadEra. | 🟡 |
| **Colecciones N:N** | Tablas `colls` + `docs_to_colls`. Habilita también el modo infantil. | 🟡 |
| **Smart crop de márgenes** | PyMuPDF: `page.get_text("blocks")` → bbox del contenido → `page.set_cropbox()`. Server-side, cacheado. Para PDFs escaneados cambia la vida en pantalla chica. | 🟡 |
| **Modo columna única** | Partir la página al medio y renderizar dos mitades. Es un `clip` rect en `page.get_pixmap()`. | 🟡 |
| **Modos de color sobre la página** | Ellos lo hacen en nativo (`applyColorModeJni`). Vos: parámetro de render en el server (invertir/sepia sobre el pixmap) o un overlay con `blendMode` en RN. Server-side sale mejor. | 🟡 |
| **Escaneo con carpetas excluidas** | Ya tenés `libraryScanService`; falta la lista de exclusiones | 🟢 |
| **Reviews con estrellas** | Columnas en `bookRepository`, como su `doc_review_edit_stars` | 🟢 |

### El que más valor tiene para vos y nadie más ofrece

| Feature | Por qué | Esfuerzo |
|---|---|---|
| **Vocabulario personal** (§3 de [readera.md](./readera.md)) | Guardar palabras con formas, contexto y nota mientras leés en inglés. ReadEra lo tiene escondido y **te cobra por la sección global**. En Bardo sale mejor: ya tenés un LLM que puede dar la definición, el contexto y las formas flexionadas **sin diccionario externo**. Es la feature donde más fácil superás a ReadEra. | 🟡 |

### Caro, y para uso personal no se justifica

| Feature | Por qué no |
|---|---|
| DJVU, CHM, RTF, ODT | Motores enteros para formatos que no vas a abrir | ⛔ |
| Pantalla dividida multi-documento | Muy caro en RN, rarísimo de usar en teléfono | ⛔ |
| Soporte Android 4.1 | Expo SDK 55 no baja ahí y no te importa | ⛔ |
| Backup `.bak` propio + sync Drive | Con un solo dispositivo, no hay problema que resolver. Si querés respaldo: exportar la SQLite y listo. | ⛔ |
| Escritura vertical CJK, ligaduras, stemming nativo | Ingeniería de años para casos que no tenés | ⛔ |
| Arquitectura multiproceso de motores | **Su solución a un problema legal que vos no tenés.** Copiarla sería cargar con toda la complejidad sin ninguno de los motivos. | ⛔ |

---

## 5. Lo que yo haría, en orden

Ordenado por valor sobre esfuerzo, no por dificultad:

1. **Anotaciones** — tabla `notes` con discriminador, más la UI de selección de texto → citar / nota / marcador. Es lo que más te falta.
2. **Pantalla "Sobre este libro"** — unifica lo que ya tenés disperso (capítulos, progreso, contexto, chat) y le da lugar natural a las anotaciones del punto 1.
3. **Formatos vía PyMuPDF** — MOBI, FB2 y CBZ casi gratis, cambiando la apertura del documento en el server.
4. **Smart crop + columna única** — el salto más grande de calidad de lectura de PDFs escaneados por línea de código escrita.
5. **Listas y colecciones** — baratas, y habilitan modo infantil si alguna vez hace falta.
6. **Vocabulario personal con LLM** — la que te deja por encima de ReadEra en vez de a la par.

Los puntos 1, 2 y 5 son app-side puro: SQLite y pantallas, cero riesgo. Los puntos 3 y 4 son del server y se apoyan en PyMuPDF que ya corre ahí.

---

## 6. Lo que conviene copiar sin pensarlo

Decisiones de diseño de ReadEra que están validadas a escala de 50 millones de instalaciones y cuestan poco:

1. **Una sola tabla para todas las anotaciones**, con discriminador de tipo. Simple y hace que la vista unificada sea trivial.
2. **Contadores desnormalizados** (`doc_colls_count`, `doc_active_count`) para que la biblioteca liste rápido sin joins.
3. **Bandera de posición obsoleta** (`doc_outdated_position`): cuando el archivo cambió, avisar en vez de saltar a un lugar equivocado en silencio.
4. **Ajustes separados para texto vs gráficos** — encaja perfecto con la dualidad texto/página que Bardo ya tiene.
5. **Leer el archivo donde está**, sin copiarlo a una biblioteca propia.
6. **Reusar colecciones para el modo infantil** en vez de construir un subsistema.
7. **Brillo por debajo del mínimo del sistema** — detalle chico, muy valorado de noche.

---

## 7. Honestidad sobre dónde queda cada uno

**ReadEra gana, y va a seguir ganando, en:** amplitud de formatos, robustez sobre archivos raros, funcionamiento offline total, tamaño, compatibilidad, gestión de biblioteca a gran escala y profundidad de ajustes de lectura. Son 9 años y un equipo de 11 a 50 personas sobre motores nativos maduros.

**Bardo gana, y puede ampliar la ventaja, en:** calidad de voz (neural vs TTS del sistema) y todo lo que toca IA — contexto por capítulo sin spoilers, chat, y potencialmente el vocabulario asistido.

**Están a la par en:** identidad de libro por contenido, sincronización audio↔página, render de página real.

Para uso personal, la brecha de amplitud casi no importa: no necesitás 14 formatos ni aguantar 500.000 documentos. Lo que importa es que leer y escuchar un libro denso sea una sola experiencia continua — y ahí Bardo ya está parado en el lugar correcto. Lo que falta son las piezas de higiene de un lector serio (anotaciones sobre todo), no capacidades nuevas de motor.
