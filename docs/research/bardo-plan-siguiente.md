# Plan siguiente: qué mejorar, qué agregar, qué falta probar

**Fecha:** 2026-09-22. Todo lo de acá está verificado contra el código, no contra los docs. Tamaños: **S** = un rato · **M** = un día o dos, o toca un módulo nativo (build nueva) · **L** = varios días.

---

## A. Lo visual: tapas, resumen y porcentaje

Esto es lo que más se nota y donde hay huecos concretos.

### A1. Las tapas solo aparecen si abriste el libro — ✅ HECHO (2026-09-22)

Hoy la tapa se genera **al abrir**: el PDF dibuja su primera página 2,5 s después de abrirse, el cómic al terminar de leer el índice, el EPUB saca la suya de la metadata. Los libros que entraron por **escaneo de carpetas nunca abiertos no tienen tapa**: se ven como un cuadrado de color con dos letras.

O sea que si escaneás una carpeta con 40 libros, ves 40 cuadrados de colores hasta que los vayas abriendo uno por uno. Es el hueco visual más grande que tenemos.

**Qué hacer:** generar las tapas de fondo después del escaneo, de a poco y por orden de lo que se ve primero. Ya existe todo lo necesario (`renderPdfCover`, `renderComicCover`, la extracción del EPUB); falta el disparador y una cola que no pelee con la lectura.
*Toca:* `src/services/libraryScanService.ts`, `src/services/pdfLocalService.ts`, `app/index.tsx`.

### A2. En un PDF o un cómic no se ve el porcentaje mientras leés — ✅ HECHO (2026-09-22)

Con la interfaz visible, la barra de páginas dice **"5 / 24"** y nada más. El chip con el porcentaje (`21 % · pág. 5`) **solo aparece en pantalla completa**. En el Inicio y en la ficha sí se ve el %, así que la app se contradice a sí misma: la biblioteca te dice 21 % y el lector no te dice nada.

**Qué hacer:** que la barra de páginas muestre las dos cosas: `5 / 24 · 21 %`. Es el cambio más barato de toda esta lista y se nota en cada sesión de lectura.
*Toca:* `app/reader.tsx` (una línea de la barra de páginas).

### A3. Los libros no tienen resumen — HECHO (2026-09-22)

No existe. Hay `descripción` en la tabla de **sagas** (que está muerta, ver E2), pero un libro no tiene dónde guardar una sinopsis. Lo que sí hay es **tu reseña** (estrellas + texto libre) en la ficha.

**Qué hacer, en orden de menos a más trabajo:**
1. **Resumen automático de las primeras líneas**: las primeras 2-3 oraciones reales del libro (salteando portadilla y créditos), guardadas al procesarlo. Cuesta poco y da algo en todos los libros, sin inventar nada.
2. **Sinopsis de la metadata**: EPUB trae `<dc:description>` en el OPF y muchos PDF traen `Subject`. Cuando está, es la buena.
3. **Campo editable** para escribirla vos.
*Toca:* `src/types/storage.ts`, `src/storage/database.ts` (migración), `src/services/bookMetadataService.ts`, `src/utils/epubStructure.ts`, `app/book.tsx`, y la tarjeta del Inicio.

### A4. Tiempo restante de lectura — ✅ HECHO (2026-09-22)

"Te faltan ~2 h 40" en la ficha y en el Inicio. Se calcula con los caracteres que quedan y una velocidad de lectura que se va midiendo sola. ReadEra lo tiene y es de esas cosas que enganchan.
*Toca:* `src/utils/formatters.ts`, `app/book.tsx`, `app/index.tsx`.

### A5. La biblioteca se ve toda de una (no está virtualizada) — ✅ HECHO (2026-09-22)

Medido: el scroll del Inicio genera tanto tirón como renderizar páginas de PDF. Se montan **todos** los libros con su tapa decodificada. Con 16 no importa; con 100 son ~800 vistas y decenas de MB de imágenes. Esto se agrava justo cuando A1 haga que todos tengan tapa de verdad.

**Nota de orden:** conviene hacer **A5 antes o junto con A1**, porque A1 multiplica las imágenes en memoria.
*Toca:* `app/index.tsx`, `src/components/Screen.tsx`.

---

## B. Comodidad al leer (lo que ReadEra tiene y se copia barato)

Ordenado por (lo que más se usa ÷ lo que cuesta):

| | Qué | Tamaño |
|---|---|---|
| B1 | **Pasar página tocando los bordes** de la pantalla | ✅ HECHO |
| B2 | **Márgenes ajustables** en modo texto | ✅ HECHO |
| B3 | **Auto-scroll** con velocidad regulable | ✅ HECHO |
| B4 | **Agrupar la biblioteca por autor** | ✅ HECHO |
| B5 | **Buscar por raíz de palabra** ("correr" encuentra "corriendo") | ✅ HECHO |
| B6 | **Selección de texto** para citar exacto | ✅ HECHO |
| B7 | **Paso de página horizontal** | ✅ HECHO |
| B8 | **Pasar página con las teclas de volumen** (módulo nativo propio) | ✅ HECHO |
| B9 | **Zoom con los dedos** | ✅ HECHO, sin dependencias nuevas |
| B10 | **Resaltar en la página del PDF lo que la voz lee** | ✅ HECHO |

---

## C. Rendimiento que quedó pendiente

| | Qué | Tamaño |
|---|---|---|
| C1 | **Reabrir un PDF cacheado sin esperar al texto.** | HECHO |
| C2 | **Un solo escritor del progreso.** | ✅ HECHO |
| C3 | **Bloques con texto perezoso** | ✅ HECHO |
| C4 | **DOCX:** cuatro copias vivas y doble descompresión. | ✅ HECHO |
| C5 | **Normalizar un TXT/DOCX grande** hacía ~9 copias completas. | ✅ HECHO |

---

## D. Lo que falta probar

Todo lo de esta sesión se probó **en el emulador** (Android 14, x86_64, GPU por software). Eso deja afuera cosas importantes:

### D1. En el teléfono de verdad — **lo primero**
Es otro procesador (ARM), otra GPU, otro motor de voz y otra cantidad de memoria. Los números de rendimiento del emulador **no valen** como referencia absoluta.

### D2. Escenarios que no toqué

- **Biblioteca grande de verdad** (100+ libros): es donde A5 y las tapas se ponen serios.
- **Escuchar con la pantalla bloqueada** y los **controles de la notificación** (pausa, ±15 s). Está implementado pero no lo verifiqué en esta ronda.
- **El temporizador de sueño cumpliéndose** (lo configuré, nunca esperé los 10 minutos).
- **Cómics CBR y CB7 sólidos de verdad** — los arreglos más delicados de esta ronda son justo de ese camino y probé con uno basado en zip.
- **Escuchar largo y seguido** (una hora o más): los cambios de tramo encadenados son donde aparecieron los bugs de voz antes.
- **Interrupciones:** llamada entrante, auriculares que se desconectan, otra app que toma el audio.
- **Rotar el teléfono** mientras leés (el remonte de la lista ya está arreglado, pero no probado girando).
- **Carpetas excluidas** del escaneo.
- **Archivos grandes:** un TXT o DOCX de decenas de MB (ver C4/C5).
- **Un PDF protegido con contraseña** y uno dañado.

### D3. Lo que conviene automatizar
Los recorridos que repetí a mano (importar, abrir cada formato, saltar por índice, voz, marcador, búsqueda) se pueden dejar como script para correrlos después de cada cambio, en vez de rehacerlos a dedo cada vez.

---

## E. Deuda y limpieza

Actualizado al 2026-09-22, después de commitear y de sacar el server.

- **E1. `src/config/apiKeys.ts` sigue en el disco.** ⏳ **Es de Facu.** Gitignoreado y sin que lo importe nadie (verificado), pero tiene `BARDO_SERVER_URL` y `BARDO_TOKEN` del server viejo más lo que quedó de la etapa con IA. El token murió con el servicio, pero si se reusó en otro lado hay que rotarlo. Borrarlo y rotar.
- **E2. Sagas/series: construido a medias y muerto.** Del código TypeScript ya salió (`sagaId`, `orderIndex` y `listBooksInSaga` no existen más), pero **la tabla `sagas` y las columnas `books.sagaId` / `books.orderIndex` siguen en la base**, documentadas como muertas en `database.ts`. Sacarlas pide migrar la tabla entera en SQLite. O se completa la función (agrupar por serie, que ReadEra tiene) o se borran en la próxima migración.
- **E3. El ícono.** ✅ **HECHO.** Cowork entregó ícono, splash, monocromo, wordmark en Lora Bold y el gráfico de tienda. Aplicado, buildeado y visto en el emulador.
- **E4. Nada está commiteado.** ✅ **HECHO.** 125 archivos en `79ff5fd` + `dc5157b`, empujados a `origin/local-como-readera`.
- **E5. Sin tests.** Parcial: **`textSpans` ya tiene** 21 tests (era el que más pesaba, porque de sus rangos dependen los bloques, los tramos de voz, el progreso y dónde caen las notas). Siguen sin test `bookDisplay`, `documentId`, `math`, `resolveChapters` y `theme`: todos chicos y de bajo riesgo.
- **E6. El server.** ✅ **HECHO.** Bardo salió de `/var/www/bardo` y de pm2 el 22/9. Detalle en `docs/ops/sacar-bardo-del-server.md`. Queda el respaldo `~/bardo-server-backup-2026-09-22.tar.gz` en el server hasta que Facu lo borre.

---

## Por dónde arrancar (mi recomendación)

**Primera tanda, todo chico y todo se ve:**
`A2` (porcentaje en PDF y cómic) → `A4` (tiempo restante) → `B1` (pasar página en los bordes) → `B2` (márgenes) → `A1`+`A5` juntos (tapas de fondo + biblioteca virtualizada).

Con eso la app se siente terminada de usar. Después vendría el bloque de comodidad (`B3`-`B6`), y `C1` cuando quieras volver a pelear por la velocidad de apertura.

**En paralelo y sin costo:** pasar el APK al teléfono (D1) — es lo único que puede invalidar conclusiones de esta ronda.

---

## Hecho el 2026-09-22 (A2 + A5 + A1)

### A2 — Porcentaje en PDF y cómic
La barra de páginas ahora dice **`5 / 24` y `21 %`** juntos. Antes el % solo
aparecía en pantalla completa, así que la biblioteca te decía 21 % y el lector
no te decía nada.

### A5 — Biblioteca virtualizada
El Inicio pasó de un scroll con todo montado a una lista virtualizada por filas
(cabecera de carpeta, o terna de libros). Sin `getItemLayout` a propósito: el
título ocupa una o dos líneas, así que la altura de una fila no es fija, y acá
no hace falta saltar a un índice.

**Medido en el emulador con una biblioteca de prueba de 107 libros:**

| | Antes (16 libros, sin virtualizar) | Ahora (107 libros) |
|---|---|---|
| Vistas nativas | crecían con cada libro | **493, fijas** |
| Cuadros con tirón | 54,7 % | **45,9 %** |
| Mediana por cuadro | 48 ms | **42 ms** |

O sea: con **6,7 veces más libros**, el scroll va mejor que antes con 16. La
cantidad de vistas ya no depende del tamaño de la biblioteca.

### A1 — Tapas generadas de fondo
`src/services/coverBackfillService.ts`. Genera las tapas que faltan de a una,
cediendo el hilo, y la biblioteca las va mostrando a medida que salen.

**Dos reglas que no se negocian:**
1. **Solo con el Inicio a la vista.** El módulo nativo mantiene UN PDF abierto
   por vez: hacer esto con un libro abierto le cerraría el documento al lector en
   cada tapa. El Inicio lo arranca al tomar foco y lo corta al salir.
2. **De a una y con pausa.** La biblioteca se muestra primero.

Por formato: PDF y cómic dibujan su primera página; el EPUB saca su portada sin
parsear el libro entero (container.xml → OPF → la entrada marcada como portada:
tres lecturas chicas y un archivo extraído). TXT y DOCX no tienen tapa adentro,
así que se quedan con la de letras, que es lo correcto.

Verificado con un cómic nuevo metido por escaneo y **nunca abierto**: apareció
con su primera página como tapa, sin tocarlo.

### De regalo: un bug que apareció al probar con biblioteca grande
Escanear una carpeta ponía en **"Seguir leyendo" un libro que nunca abriste**.
Un libro que entra por escaneo guarda `lastOpenedAt` igual a `importedAt`, y la
consulta ordenaba solo por `lastOpenedAt`: con 90 libros nuevos, la tarjeta
mostraba uno cualquiera de ellos. Ahora se pide explícitamente un libro que
hayas abierto, y si no abriste ninguno todavía se cae al más reciente.

### Nota sobre el emulador
Quedaron 90 libros de prueba (`libro-001…090.txt`) en `Download/Libros` del
emulador. Sirven para probar con biblioteca grande; se borran con
`adb shell rm /sdcard/Download/Libros/libro-0*.txt`.

---

## Segunda tanda del 2026-09-22 (A4 · B1 · B2 · B3 · B4 · B5 · C2 · C4 · C5 · E2 · E5)

### Se ve
- **Tiempo restante** en la ficha y en la tarjeta del Inicio: "1 % leído · EPUB · te faltan ~36 h 07". Un cómic se mide en páginas; un **PDF escaneado** también, porque no tiene texto que contar (antes decía "~1 min" porque lo único que contaba era el relleno provisorio).
- **Tocar los bordes pasa de página** en PDF y cómics. El centro sigue mostrando y ocultando los controles. Se puede apagar, desde Aspecto o desde Ajustes.
- **Márgenes ajustables** del modo texto (8 a 56), en Aspecto y en Ajustes. Cambiarlos conserva la posición.
- **Auto-scroll** con cinco velocidades. Se frena solo mientras suena la voz, porque ahí manda el audio.
- **Ordenar por autor agrupa por autor** (antes solo ordenaba, y el agrupado era siempre por carpeta).
- **Buscar por raíz**: "parrafos" encuentra "párrafo" — 75 resultados donde antes había cero. Es conservador a propósito: si la palabra no tiene una terminación reconocible, la búsqueda se comporta exactamente como siempre, así solo puede sumar resultados.
- **"Escuchar" ya no aparece en libros sin texto** (cómics y PDF escaneados), ni en el Inicio ni en la ficha.

### No se ve pero pesa
- **Un solo escritor del progreso.** Mientras suena la voz guarda el servicio de audio; el controlador se calla. Antes los dos escribían la misma posición, ~2 veces por segundo durante horas de escucha.
- **DOCX:** el título y el autor se leen del zip con el módulo nativo (una entrada, no el archivo entero), y el buffer para mammoth vive en su propia función. De cuatro copias del documento vivas a la vez y dos descompresiones, a dos copias y una.
- **Normalizar un TXT o DOCX grande** se hace por tramos: el pico de memoria baja de nueve copias del libro a nueve de medio mega.

### Limpieza
- **Sagas: borrado.** La jerarquía saga → libro estaba a medio construir y muerta: existían la tabla, dos columnas y una consulta, y **nadie escribía nunca un sagaId**. Se sacó del código (tipo, campos y consulta). La tabla y las columnas quedan en la base, con un comentario que explica por qué: sacar una columna en SQLite obliga a reconstruir la tabla y no aportaba nada.
- **Tests de `textSpans`** (21 nuevos): era lo que menos cobertura tenía y de donde dependen los bloques, los tramos de voz, el progreso y dónde caen las notas. Total: **210 tests**.

### Lo que sigue pendiente
`A3` (resumen de los libros) · `C1` (reabrir un PDF cacheado sin esperar el texto) · `C3` (bloques con texto perezoso) · `B6`-`B10` · todo el bloque `D` de pruebas, empezando por el teléfono de verdad · y `E1`: **`src/config/apiKeys.ts` sigue ahí, con claves del server viejo, esperando que lo borres y las rotes.**

---

## Tercera tanda del 2026-09-22 (A3 · C1)

### A3 — Resumen de los libros

Sección **"De qué va"** en la ficha, con tres fuentes en orden:

1. **La sinopsis que trae el archivo**: `<dc:description>` del OPF en EPUB, de
   `core.xml` en DOCX, y el campo `Subject` en PDF (que es donde los editores la
   ponen; se agregó al módulo nativo).
2. **Las primeras oraciones de la prosa**, salteando portadilla, créditos,
   "Proyecto Gutenberg" e índice. No inventa nada: el texto está tal cual en el
   libro.
3. **Lo que escribas vos**: se toca el resumen y se edita; vaciarlo lo borra.

**Un detalle que salió al probarlo:** el primer libro mostró "generated by
python-docx" como resumen — es lo que escriben las herramientas en ese campo
cuando el autor no puso nada. Se filtran esas firmas (Word, LibreOffice,
calibre, pandoc, "Created with…") y en esos casos gana el resumen automático.

### C1 — Reabrir un PDF ya procesado es instantáneo

La primera apertura ya lo era; **reabrirlo** no: se esperaba a traer todo el
texto y armar todos los bloques antes de dibujar la página 1, cuando para eso
solo hace falta el mapa de páginas. Ahora se lee únicamente ese mapa (una
consulta chica), se dibuja, y el documento completo entra después por el mismo
camino que ya usaba la preparación de texto.

**Ojo con esto:** solo aplica cuando se lee POR PÁGINAS. La primera versión no
distinguía y en "texto corrido" mostraba el relleno provisorio en vez del libro
—y encima guardaba esa posición falsa como progreso—. En ese modo el texto es
justamente lo que se muestra, así que no hay nada que adelantar.

### De regalo: la base se recupera sola

Instalando una build sobre la app corriendo, el objeto nativo de SQLite quedó
liberado por debajo: **toda** consulta falló y la biblioteca se veía vacía con un
cartel de error, hasta cerrar y abrir a mano. Ahora ese caso se detecta, se
reabre la base y se reintenta una vez.

### Lo que sigue pendiente

`C3` (bloques con texto perezoso) · `B6` selección de texto · `B7` paso
horizontal · `B8` teclas de volumen (módulo nativo) · `B9` zoom con los dedos y
`B10` resaltar en la página: **estos dos últimos piden dependencias nuevas o
extraer rectángulos de Pdfium, y conviene decidirlos aparte.** Y todo el bloque
`D` de pruebas, empezando por el teléfono de verdad.

Total: **224 tests**.

---

## Cuarta tanda del 2026-09-22 (B10 · B9)

### B10 — Se resalta en la página lo que la voz está leyendo

ReadEra puede hacerlo porque su TTS vive **adentro** de su motor de render:
`speechRectJni` le devuelve las coordenadas de lo que está diciendo. Nosotros no
tenemos esa integración, pero **no hizo falta construirla**: la librería de
Pdfium que ya empaquetábamos expone `textPageGetCharBox` y compañía, que es
exactamente lo mismo.

Cómo quedó: un método nativo devuelve dónde cae un texto dentro de una página,
en coordenadas 0..1, y el lector pinta un rectángulo encima. Funciona igual en
un PDF con texto que en uno escaneado con OCR, porque las coordenadas salen del
propio archivo.

**El detalle que costó:** el texto del libro está unido y limpiado (encabezados
repetidos sacados, guiones de corte unidos), así que una posición global NO
corresponde uno a uno con el índice de carácter crudo de la página. En vez de
llevar esa correspondencia, se le pasa al nativo **la palabra y una pista de por
dónde cae** (0 a 1) y se elige la aparición más cercana. Es robusto a las
diferencias de limpieza, que son de unos pocos renglones.

**Tres bugs propios en el camino, los tres del mismo tipo — el dato llegaba bien
pero no se veía:**
1. Se cerraba la página de Pdfium dejando viva su capa de texto: una depende de
   la otra, así que devolvía cero rectángulos en silencio.
2. El efecto que pide los rectángulos se vuelve a correr cuatro veces por
   segundo, y su limpieza **cancelaba el pedido en vuelo antes de que llegara**:
   no aparecía nunca. La comparación por clave ya alcanzaba.
3. Las celdas de una `FlatList` no se redibujan cuando cambia algo que no está
   en sus datos: faltaba `extraData`. (Esto también explicaba por qué el ícono
   de la página que se está leyendo tampoco se actualizaba.)

Y uno de geometría: con el recorte de márgenes activo, lo que se ve es la caja
de contenido, no la página entera — los rectángulos había que pasarlos a ese
marco o quedaban corridos.

### B9 — Zoom con los dedos, sin dependencias nuevas

Se evaluó agregar `reanimated`: son **+2 MB por arquitectura, un plugin de Babel
y un segundo motor de JavaScript que se crea al arrancar**, uses o no el zoom.
No hizo falta: `PanResponder` y `Animated` vienen en React Native y alcanzan de
sobra para ampliar una imagen. **Sin zoom activo no cuesta nada.**

- Se amplía UNA página (la que estás mirando), no la lista: con una lista
  virtualizada, transformar el contenedor rompe las cuentas del scroll.
- Con zoom, la lista no scrollea y el arrastre mueve dentro de la página, con
  topes para no salirse de los bordes.
- **Se vuelve a dibujar la página a más resolución** cuando el zoom pasa de
  1,3x: ampliar el JPEG pensado para el ancho de pantalla se ve borroso. El
  caché de páginas ya distinguía por ancho, así que cada nivel se guarda solo.
- **Doble toque** para ampliar y volver. El toque simple no espera a ver si
  viene el segundo: responde en el acto y, si llega, se deshace — esperar
  300 ms en el gesto que más se usa se siente pesado.
- Un indicador abajo a la derecha muestra el nivel y sirve de salida.

**Lo que no pude probar:** el pellizco en sí. El emulador no permite inyectar
dos dedos; se probó el doble toque, el arrastre con zoom, el redibujado a más
resolución y la salida por el indicador. **El pellizco hay que probarlo en el
teléfono.**

Medido narrando con resaltado: 24 % de CPU (la síntesis de voz es la mayor parte).

---

## Quinta tanda del 2026-09-22 (B7 · B8 · B6 + la paleta de marca)

### B7 — Pasar de costado

Una página por vez, encajada, como pasar una hoja. Es un ajuste (apagado por
defecto) y está tanto en Ajustes como en la hoja "Aspecto" del lector.

Dos bugs propios en el camino, los dos encontrados en el emulador:

1. **La fila estaba en la rama equivocada.** La había puesto dentro del grupo
   que sólo aparece en **texto corrido**, y el ajuste sólo tiene sentido cuando
   hay páginas: no se veía nunca. Ahora está donde va, condicionada a `pageInfo`.
2. **El `memo` de `PdfPageList` no comparaba `horizontal`.** Tocabas el ajuste y
   la lista seguía dibujada como estaba. Es el mismo tipo de bug que el de
   `extraData` con el resaltado de la voz: en esa lista, todo lo que no está en
   `data` hay que declararlo explícitamente.

Además, de costado la hoja **se achica para entrar entera de alto** (no hay
scroll vertical al que recurrir) y el indicador de scroll horizontal se apaga.

Probado: swipe 8→9→10→9, tocar los bordes, la barra de páginas salta a la 25,
el swipe vertical no mueve nada, y al apagarlo vuelve el scroll vertical en la
misma página.

### B8 — Los botones de volumen pasan de página

Módulo nativo propio nuevo: **`modules/bardo-keys`**. Android no le manda las
teclas de volumen a React Native, así que hay que sacárselas antes.

**Por qué envolver el `Window.Callback` y no tocar `MainActivity`:** la carpeta
`android/` la genera `expo prebuild` y se borra entera cada vez que se regenera.
`modules/` sí está en git. El envoltorio delega TODOS los métodos de la interfaz
intactos y sólo se queda con las dos teclas de volumen.

- Sólo captura con un libro abierto y con el ajuste puesto (apagado por
  defecto); al salir del lector devuelve el callback original.
- Sólo el `ACTION_DOWN` sin repetición: dejar el dedo apretado no pasa veinte
  páginas de golpe. El `ACTION_UP` también se consume, o Android igual muestra
  el panel de volumen.
- En texto corrido no hay páginas: corre una pantalla con un par de renglones de
  solape.

Probado: en el lector 26→27→28→27 sin que aparezca el panel de volumen; al
volver al Inicio, el panel de volumen aparece de nuevo (la captura se soltó).

### B6 — Citar exacto lo que tocaste

En el modo texto el bloque ya se podía citar entero. Sobre una página dibujada
no hay texto que seleccionar: hay una imagen. Ahora, al mantener apretado, se le
pregunta a Pdfium **qué dice en ese punto** y se cita la **oración completa** que
hay ahí (`textAtPointAsync`).

Lo difícil no fue el punto sino **el índice**: el texto que devuelve Pdfium es el
crudo del PDF (renglones cortados donde los cortó la maquetación) y el del libro
viene unido y limpiado, así que ni la cita coincide carácter a carácter ni el
índice sirve tal cual. `src/utils/pageQuote.ts` compara las dos versiones **sin
espacios**, guardando de dónde salió cada carácter, y devuelve un índice real
del texto del libro. 7 tests.

Para llegar al punto hay que deshacer tres cosas en orden: que la hoja esté
centrada en su hueco, **el zoom** (transforma la imagen pero no el `Pressable`
que recibe el toque) y el recorte de márgenes. Si el PDF no tiene texto (un
escaneo sin OCR) o el dedo cayó en un blanco, queda la nota de la página entera,
como antes. La cita de la hoja además es `selectable`: se puede copiar.

Probado en el emulador: tres puntos distintos de la misma página devuelven las
tres oraciones correctas (`había llovido un poco antes de su llegada.` /
`El viajero llegó al pueblo…` / `Nadie lo esperaba…`), la cita se guarda con su
página y al tocarla en "Sobre este libro" vuelve a la página 8.

**Dos trampas del entorno que costaron una vuelta entera** (quedan anotadas
porque van a volver):

1. **Los heredocs de este Windows se comen los escapes.** `'\n'` escrito dentro
   de un `python - <<'PY'` terminó como un salto de línea REAL adentro del
   literal de carácter de Kotlin. El archivo no compilaba.
2. **`./gradlew … | grep …` devuelve el estado del grep, no el de gradle.** La
   build fallaba y el comando reportaba éxito, así que el APK instalado seguía
   siendo el anterior: la función nueva no existía en el módulo nativo y todo
   caía siempre por el camino de respaldo. Parecía un bug de lógica y no lo era.

De acá en más: lo que tenga escapes va con la herramienta de edición, y gradle
se corre sin pipe (o cerrando con `echo ${PIPESTATUS[0]}`).

### La paleta "Tinta y lacre"

Cowork la definió en `docs/brand/bardo-marca.md` y está aplicada: `theme.ts`
completo (claro/oscuro/sepia), los colores hardcodeados de `AppErrorBoundary`,
`_layout` y `BookGridItem`, `app.json` y `colors.xml`. Los tres papeles del
lector no cambian a propósito: están duplicados en `PdfPageList.tsx` y en el
tintado nativo de `BardoPdfModule.kt`.

La paleta vieja era la de Tailwind por defecto y el ámbar sobre fondo claro daba
**1,99:1** (el mínimo para un elemento de UI es 3:1). Ahora todo pasa.

**Falta la tipografía de marca (Lora Bold):** no está el `.ttf` en el repo y
`expo-font` no está instalado. Queda esperando a Cowork y al OK de Facu para la
dependencia.

---

## Sexta tanda del 2026-09-23 (pedidos de Facu sobre la biblioteca)

Seis pedidos, todos probados en el emulador.

### Badges de estado y "marcar como leído"

La celda ahora lleva una píldora arriba a la izquierda: **Leyendo** (lacre),
**Leído** (verde) o **Para leer** (tinta). El criterio sale de `getBookBadge`,
que usa **los mismos tres criterios que los filtros** de la biblioteca, así que
el badge y el filtro no se pueden contradecir.

Marcar leído / para leer / desmarcar está en el menú de mantener apretado, que
funciona igual en libros y en cómics porque es el estado guardado, no depende de
que haya texto que narrar.

### Las subcarpetas ya no se mezclan

Era el pedido más de fondo. **El escaneo entra en las subcarpetas pero guardaba
sólo el nombre del archivo**, así que una carpeta con subcarpetas se mostraba
como una bolsa de 95 libros sueltos.

La ruta sí estaba en la URI de SAF (`…/tree/<raíz>/document/<ruta completa>`).
`src/utils/libraryFolders.ts` la saca de ahí (15 tests), así que **los libros ya
guardados se reagrupan solos, sin migrar la base ni volver a escanear**. Las
subcarpetas se pliegan igual que la carpeta y las muy anidadas se muestran como
`… / Marvel / 2024`.

**Dos bugs que aparecieron probando esto**, los dos de reubicación de archivos:

1. **`uriExists` devolvía `true` cuando fallaba.** En SAF, preguntar por un
   documento que se movió **tira excepción** en vez de contestar "no existe", así
   que un archivo movido de carpeta se leía como "sigue estando" y nunca se
   reapuntaba: el libro no abría más y seguía apareciendo en la carpeta vieja.
2. **El Inicio recargaba la lista sólo si había libros NUEVOS.** Mover archivos
   reapuntaba bien en la base pero la pantalla se quedaba con las rutas viejas.
   `scanLibraryFolders` ahora devuelve cuánto CAMBIÓ (nuevos + reubicados).

Probado moviendo archivos a mano en el emulador: `Saga Ejemplo (5)`,
`Comics/Marvel (3)` y `Sub (2)` aparecen agrupados y los movidos se reubican.

### Renombrar

Cambia el **título que se muestra**, no el archivo del teléfono: renombrar de
verdad pediría permiso de escritura sobre la carpeta y, si el libro vino de un
escaneo, el próximo escaneo lo encontraría como uno nuevo. Vaciando el campo
vuelve el nombre del archivo.

### El "+" ahora pregunta

Antes abría directo el selector de archivos y agregar una carpeta estaba sólo en
Ajustes — que es lo primero que querés hacer con la app recién instalada. Ahora
ofrece **Un libro** o **Una carpeta**.

### Ajustes subdividido

"Lectura" tenía quince filas de cosas que no tenían que ver entre sí. Quedó
partido en **Texto** (cómo se ve el texto), **Páginas y gestos** (PDF y cómics) y
**Pantalla y arranque**. Voz, Biblioteca, Almacenamiento y Acerca de no cambian.
