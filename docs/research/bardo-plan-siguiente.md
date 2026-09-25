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

---

## Orden de aplicación de la lista de mejoras (2026-09-23)

Cowork pasó una lista de ~25 ideas con costo-beneficio (está en `docs/hub/inbox.md`). Verifiqué sus
afirmaciones técnicas contra el código: **todas correctas**. Esto es el orden en que las aplicaría.

### El criterio

No es sólo "lo barato primero". Es, en este orden:

1. **Nada antes de probar en el teléfono.** Todo se probó en emulador. Esta semana aparecieron ~25
   bugs reales y **casi todos fueron de posición, progreso o sincronía de la voz** — encontrados
   probando, no con typecheck.
2. **Barato Y LEJOS del núcleo frágil** (offsets de voz, progreso, posiciones) antes que barato y
   cerca.
3. **Una tanda por build**: cada regresión de esta semana salió probando en el aparato.
4. **Lo que come memoria, al final y con medición antes y después.**

Línea de base medida (emulador, 96 libros): arranque **366 ms**, **120 MB PSS / 220 MB RSS**,
APK **46 MB** con una ABI. El recurso escaso es la memoria, no la CPU: es por lo que Android mata
la app en segundo plano, justo escuchando con la pantalla apagada.

### Hecho

- **Apagar el Auto Backup de Android.** Era el primero de los "imprescindibles". `allowBackup` está
  en `false` desde `app.json`; verificado en el aparato (flags sin `ALLOW_BACKUP`).

### Tanda 0 — El teléfono (bloquea todo lo demás, no es código)

Bloque D. Sobre todo: **el pellizco del zoom** (nunca probado, el emulador no inyecta dos dedos),
escuchar con la pantalla bloqueada, cómics CBR/CB7 sólidos de verdad, escuchar una hora seguida e
interrupciones (llamada, auriculares).

### Tanda 1 — Baratas y lejos del núcleo (todas S, cero rendimiento)

Ninguna toca los offsets de la voz ni el progreso, que es donde vivieron todos los bugs:

1. **Anunciar capítulos** — utterance aparte, fuera de los offsets del texto.
2. **Velocidad y voz por libro** — una columna y leerla al abrir.
3. **"Dónde quedaste"** — una consulta al abrir.
4. **Botón "Marcar"** en la pantalla de voz — reusa el flujo de notas.
5. **Buscar en todas las notas** — una consulta SQL.
6. **Exportar notas a Markdown** — leer y compartir.
7. **Temporizador "al terminar el capítulo"** — `ChapterInfo` ya trae `startChar`/`endChar`. Es la
   única de la tanda que roza el bucle de la voz, así que va última y se prueba aparte.

### Tanda 2 — El resguardo, que ahora hace falta más (M)

**Apagar el Auto Backup dejó a Facu sin red de contención.** Antes esto era "vale la pena"; ahora
es lo primero después de la tanda 1:

8. **Exportar / importar mis datos** (JSON por el selector SAF). Sin dependencias. La huella de
   contenido ya existente reubica los libros al restaurar.
9. **Sagas** — las columnas ya están en la base (E2): o se completa acá, o se borran.
10. **Biblioteca en lista además de grilla** — gratis, ya está virtualizada.

### Tanda 3 — Cerca de la voz (M, riesgo real)

11. **Diccionario de pronunciación.** `speechText.ts` hace reemplazo **1 a 1** a propósito: el
    resaltado se ubica por proporción sobre el largo del tramo. Cambiar largos pide un mapa de
    posiciones como el de `pageQuote.ts`. Va después de que la voz esté validada en el teléfono.
12. **Pantalla "Reproduciendo"** — mucha UI, ningún riesgo.

### Tanda 4 — Informar (M)

13. **Barra de progreso con mapa** · 14. **Estadísticas** (tabla nueva, migración) ·
15. **Personajes sin IA** — ojo: doblar un libro de 1,7 MB aloca otra copia entera. Hay que reusar
el texto ya doblado, no rehacerlo. La estimación de 0,1-0,3 s es optimista para Hermes.

### Tanda 5 — Visual

16. **Compartir cita como imagen** · 17. **Noche cálida** (toca el tintado nativo, build) ·
18. **"Seguir leyendo" con el color de la tapa** (calculado una vez al generar la tapa).

### Quedaron afuera a propósito, y por qué (decisión de Facu, 2026-09-23)

Si alguna vuelve a surgir, acá está el motivo por el que no entró y qué haría falta para entrarla.

- **Miniaturas de páginas** (una tira de páginas chicas para saltar mirando). Por qué no: cada
  miniatura es un bitmap más en memoria; un tomo de 400 páginas son decenas de MB, y **la memoria es
  el recurso escaso**: es por lo que Android mata la app cuando escuchás con la pantalla apagada.
  Además compite con el dibujo de la página que estás leyendo (la cola de `pdfLocalService` es LIFO
  para que la página visible gane siempre). Para entrarla: miniaturas en disco y no en memoria, de a
  una ventana de ±10, medidas con `dumpsys meminfo` antes y después con el lector narrando.
- **Dos páginas por pantalla en horizontal.** Por qué no: duplica las páginas dibujadas por pantalla
  (misma presión de memoria de arriba) y el ancho por página baja a la mitad, así que en un teléfono
  el texto queda ilegible sin zoom. Tiene sentido sólo en tablet. Para entrarla: sólo cuando el
  ancho real supera ~900 dp, y medida.
- **Más fuentes de lectura.** Por qué no: una familia completa (regular, itálica, negrita, negrita
  itálica) pesa 400-600 KB y va adentro del APK para siempre; hoy se embebe sólo Lora Bold para la
  marca y el cuerpo usa la serif y la sans del sistema, que ya son buenas. Para entrarla: una sola
  familia elegida por Facu, medida en tamaño de APK.
- **Widget en la pantalla de inicio** ("Seguir leyendo" afuera de la app). Por qué no: es código
  nativo (AppWidgetProvider + RemoteViews) más un config plugin de Expo, y hay que mantenerlo aparte
  de la app; el beneficio es un toque menos. Para entrarlo: módulo nativo propio, como `bardo-keys`.
- **Otra voz para los diálogos.** Descartada, no pospuesta: obliga a partir cada tramo de voz en
  pedazos (narrador / diálogo) y eso toca justo el mapeo tiempo→texto, que es donde vivieron casi
  todos los bugs de la app. Detectar diálogos por rayas y comillas falla seguido, y el resultado
  cambia de voz a mitad de una frase. Mucho riesgo, poco valor.
- **Selección de texto con el dedo sobre la página del PDF** (arrastrar para elegir palabras). Por
  qué no: Bardo ya cita exacto tocando el párrafo (B6); seleccionar con asas sobre una imagen
  dibujada pide rectángulos por carácter desde Pdfium y una capa de gestos que pelea con el zoom.

---

## Orden a mano de la biblioteca (2026-09-23)

Facu quería arrastrar las tapas para armar su orden. **No se hizo arrastrando en la grilla**, y el
porqué importa:

- La grilla **no tiene alto de fila fijo** (a propósito: el título ocupa una o dos líneas), y las
  filas son de a tres, así que mover un libro obliga a re-armarlas todas. El arrastre ahí sale caro
  y frágil.
- La librería habitual (`react-native-draggable-flatlist`) arrastra **`reanimated` +
  `gesture-handler`**: +2 MB por arquitectura y un segundo motor de JavaScript que arranca siempre,
  se use o no. Las alternativas sin reanimated **no virtualizan**, o sea que deshacen A5.
- Y había un choque de gestos: mantener apretado ya abre el menú del libro.

**Lo que se hizo:** el menú gana "Acomodar esta carpeta" y eso abre un modo aparte con la carpeta
en **una sola columna**, donde se arrastra desde un asa. Con alto de fila fijo, saber sobre qué
libro estás parado es una división. Sin dependencias nuevas (`PanResponder` + `Animated`), sin
tocar el arranque, y **el menú del libro queda exactamente como estaba**.

Detalles que importan:

- **`books.orderIndex` ya existía** (columna muerta de sagas, E2): cero migración.
- Los índices se guardan **espaciados de a 1000**, así mover un libro reescribe unas pocas filas.
- **`orderIndex` 0 = "nunca lo ordenaste", y esos van AL FINAL.** Es lo que evita que un libro que
  aparece en un escaneo nuevo se cuele arriba del orden que armaste. Verificado en el emulador con
  un archivo llamado `aaa-recien-llegado`: quedó último, no primero.
- Se acomoda la **subcarpeta**, no la carpeta entera: es donde el orden tiene sentido y evita poner
  95 libros en una lista para mover uno.
- Al guardar, el orden de la biblioteca pasa solo a "El mío": si no, el trabajo recién hecho no se
  vería.

**Un bug encontrado probando:** el orden no sobrevivía al reinicio. `settingsRepository` valida
`librarySort` contra una lista blanca escrita a mano que no conocía `'manual'`, así que lo
descartaba en silencio y volvía a `'recent'`. Arreglado de raíz: la lista (`LIBRARY_SORTS`) es ahora
la fuente de verdad y **el tipo sale de ella**, así no se pueden volver a desincronizar.

13 tests nuevos en `bookDisplay` (que además era uno de los huecos de E5).

---

## Las cinco tandas, hechas (2026-09-23)

Todo probado en el emulador (AVD `bardo_test`, build release x86_64). Un commit por tanda en
`local-como-readera`.

| Tanda | Commit | Qué entró |
|---|---|---|
| 1 | `706e4a6` | Las siete baratas (buscar en notas, exportar notas, temporizador de capítulo…) |
| 2 | `2c8fbaa` | Exportar/importar mis datos, sagas, biblioteca en lista |
| 3 | `83dccfc` | Diccionario de pronunciación, pantalla "Reproduciendo" |
| 4 | `1762710` | Mapa del libro, estadísticas (DB v8), personajes sin spoilers |
| 5 | (este) | Cita como imagen, noche cálida, "Seguir leyendo" con el color de la tapa (DB v9) |

**Lo que se aprendió probando, y no estaba en el plan:**

- **Mapa en PDF: por páginas, no por texto.** Un PDF con texto al principio y láminas al final
  ponía "la mitad" en la página 10 de 40. El mapa usa la misma escala que el porcentaje, y un toque
  lejos de toda marca va a la *página* tocada (las láminas no tienen posición de texto).
- **Personajes: medido en Hermes, no estimado.** Medio Quijote (1 millón de letras) tarda ~0,3 s.
  Se calcula al abrir la hoja, sólo sobre lo ya leído, recorriendo el texto con índices sin copiarlo.
  "Finalmente" pasaba por nombre: ahora un nombre necesita ≥25 % de apariciones en medio de oración.
- **Estadísticas en el respaldo**, con `MAX` al importar: importar dos veces no duplica tiempo.
- **Noche cálida es también el chrome del lector** (botones, barra, carteles, número de página):
  un botón lila en pantalla arruina la idea de "sin luz azul". El número de página sobre el color de
  acento usaba blanco fijo: ilegible sobre lila y sobre ámbar; ahora usa `primaryText`.
- **Color de la tapa**: el tono que *manda* (12 tonos pesados por saturación), no el promedio.
  Tapa gris → `'none'`, sin tinte. Una tapa nueva invalida el color. La mezcla baja sola si el texto
  quedara por debajo de 4,5:1 (test con tapas extremas en los tres fondos).
- **Cita como imagen**: `react-native-view-shot` + `expo-sharing` (dependencias nuevas, nativas).
  Hay que pasar ancho *y* alto o sale a la densidad de pantalla (~800 px); esquinas rectas en la
  imagen porque las transparentes se ven negras o blancas según la app.

**Bug viejo encontrado de rebote (grave):** al reabrir un PDF, a veces volvía a la página 1 y la
**guardaba**, perdiendo dónde ibas. Carrera: con el caché caliente, el texto definitivo llegaba antes
del primer render del documento provisorio y preguntaba "¿en qué página estás?" cuando la respuesta
todavía era la 1. Pasaba 2 de cada 4 veces tras instalar una versión nueva; con el arreglo, 6 de 6
bien. La página de arranque se fija al crear el documento provisorio, no en el render siguiente.

**Otro de paso:** un libro marcado "Leído" a mano sin progreso decía "Leído · Sin empezar".

### Limpieza de código y base v10 (2026-09-23)

Pedido de Facu: "limpiá el código, hacé la migración". Se fue todo lo que nadie leía:

- **Base v10:** la tabla `sagas` y `books.sagaId` (jerarquía saga → libro que nunca se terminó; las
  sagas de hoy salen de la carpeta), `chapters.povCharacter` / `povNumber` (de la etapa con IA) y la
  tabla `documents` (la biblioteca anterior a `books`, vacía). SQLite no deja borrar una columna que
  es clave foránea, así que `books` y `chapters` se reconstruyen: claves foráneas apagadas antes
  (con ellas prendidas, borrar la tabla vieja borraría en cascada notas, progreso y colecciones),
  todo en una transacción, y prendidas de nuevo al final. Probado sobre la base real del emulador
  (98 libros, 156 capítulos, notas, colecciones, progreso, estadísticas): las 272 filas idénticas
  antes y después, `foreign_key_check` vacío.
- **Código:** `isPreparingPdfText`, el tipo `StoredDocument`, `volumeKeysAvailable`,
  `getChapterById`, `listChaptersByPov`, los campos POV en tipos, detector y repositorio (el patrón
  "BRAN (1)" se sigue detectando como título), y el parámetro `fullText` que `buildAnchoredChunks`
  recibía sin usar. `tsc --noUnusedLocals --noUnusedParameters` queda limpio (salvo `apiKeys.ts`,
  que es de Facu).
- **README** al día en los dos idiomas.

---

## Cerrar la versión (2026-09-23) — sin funciones nuevas hasta que esto esté

Pedido de Cowork después de revisar las cinco tandas. Lo que se pudo hacer sin el teléfono, hecho;
lo demás, acá para hacerlo con Facu.

### Medición contra la versión anterior (hecha)

Misma máquina, mismo emulador y la misma biblioteca de 98 libros, **alternando** la build de antes de
la tanda 1 (`ef9cd75`) con la de ahora (`6d4e417`), para que el ruido del emulador pegue igual en las
dos. El 366 ms de la línea de base era de otro día y otro estado del emulador: comparar contra ese
número habría inventado una regresión de 100 ms.

| | Antes (`ef9cd75`) | Ahora (`6d4e417`) |
|---|---|---|
| Arranque en frío, mediana | ~690 ms | ~690 ms |
| Inicio quieto (PSS / RSS) | 125-129 / 229-233 MB | 97-121 / 202-225 MB |
| Lector con la voz narrando (PSS) | 200-226 MB | 201-208 MB |
| APK x86_64 | 49,38 MB | 49,52 MB (+135 KB) |

**Sin regresión.** El arranque es igual, la memoria igual o menor y el APK apenas más grande. El
ruido del emulador es de ±10 MB y ±150 ms entre corridas iguales: por eso se alterna.

### En el teléfono de Facu (la Tanda 0, que nunca se hizo)

Instalar la build **encima** de la versión que ya tiene (no desinstalar): así las migraciones
v7→v9 corren sobre sus datos reales.

1. Abrir la app: la biblioteca, el progreso y las notas siguen ahí.
2. Una hora escuchando con la pantalla bloqueada. Que no se corte.
3. Temporizador "al terminar el capítulo": que pare ahí.
4. Anuncio de capítulo al pasar de uno a otro.
5. Una entrada de pronunciación, oída con **su** motor de voz.
6. Pellizco de zoom en un PDF.
7. Reabrir varios PDF varias veces: cada uno vuelve a su página.
8. Exportar mis datos → importar ese mismo archivo: nada se duplica.
9. **Densidad de la interfaz:** entraron Mis notas, Estadísticas, Reproduciendo, Personajes, Mapa,
   lista/grilla, pronunciación y voz por libro. Cada una está bien sola; mirar con Facu si juntas
   cargan la app. Sin cambios hasta verlo en la mano.

### Pendiente de Facu, no se toca

- Bloquear el permiso `INTERNET` en release.
- Borrar `Claude outputs/` y `_to_delete/` (ahora están en `.gitignore`: no pueden entrar a git).
- Borrar `src/config/apiKeys.ts` y rotar lo que haya adentro si se reusó.

---

## Publicar en Google Play — el plan (2026-09-23)

Cuatro fases, en orden. Cada tarea dice quién la hace: **Facu**, **agente** (yo) o **Cowork**.
Nada de esto arranca hasta que Facu diga; lo de Cowork ya está pedido en el buzón para que esté
listo cuando llegue el momento.

### Fase 0 — Cerrar la app (Facu)

- [ ] Probar en el teléfono lo que falta: el temporizador de sueño y los controles de la
      notificación (pausa, ±15 s, con la pantalla bloqueada).
- [ ] Instalar la build con la base v10 **encima** de la actual y ver que todo sigue ahí.
- [ ] Mirar la densidad de la interfaz con todo lo nuevo (punto 5 de Cowork) y decidir si algo se
      esconde detrás de un ajuste.

### Fase 1 — Decisiones (Facu, antes de que yo toque nada)

- [ ] **Identificador de la app.** Hoy es `com.personal.pdfvoicereader` y una vez publicado no se
      cambia nunca. Opciones: dejarlo (nadie lo ve) o cambiarlo a algo como `ar.bardo.app`
      (tu teléfono la ve como otra app: exportás, instalás, importás, borrás la vieja).
- [ ] **Nombre público** en la tienda (30 caracteres máximo). Cowork verifica que "Bardo" no choque
      con otra app y propone el subtítulo.
- [ ] **Países y precio.** Gratis, sin anuncios, sin compras. ¿Todo el mundo o sólo algunos países?
- [ ] **Dónde vive la política de privacidad.** Hace falta una URL pública. No en los sitios del
      server. GitHub Pages sobre este mismo repo es lo más simple.

### Fase 2 — Preparar el paquete (agente, una tarde)

- [ ] Sacar los permisos que sobran con `tools:node="remove"`: `INTERNET` (no hay ninguna llamada
      de red), `RECORD_AUDIO` (lo mete `expo-audio` aunque `recordAudioAndroid` esté en `false`) y
      `SYSTEM_ALERT_WINDOW` (sobra de la plantilla). Verificar con `aapt dump permissions`.
- [ ] Clave de firma propia (`keytool`), guardada FUERA del repo, con contraseñas en
      `~/.gradle/gradle.properties`. **Facu guarda copia del archivo `.jks` y las contraseñas en dos
      lugares**: si se pierde, la app no se puede actualizar nunca más. Play App Signing prendido, así
      Google guarda la clave final y la nuestra es sólo de subida.
- [ ] `bundleRelease` → AAB (Play no acepta APK). `versionCode` sube en cada subida (hoy 1).
- [ ] Capturas de pantalla en el emulador: al menos 4 (Inicio, lector PDF, lector de texto de noche,
      Reproduciendo), 1080×2400, sin datos de prueba visibles (biblioteca con libros reales).
- [ ] Un video corto (20-30 s) de la voz sonando con la pantalla bloqueada, por si Play lo pide para
      justificar el servicio en segundo plano.

### Fase 3 — Cuenta y ficha (Facu + Cowork)

- [ ] **Facu:** cuenta de desarrollador (pago único de 25 USD, verificación de identidad y teléfono).
      Cuenta personal, no de organización.
- [ ] **Cowork:** textos de la ficha en español e inglés (título, descripción corta de 80 caracteres,
      descripción larga de hasta 4000), texto de la política de privacidad ("no recopila nada"), y
      qué mostrar en cada captura.
- [ ] **Facu con el agente al lado:** formularios de Play: categoría (Libros y referencias),
      clasificación de contenido (cuestionario), público objetivo (adultos), anuncios (no), seguridad
      de datos (no recopila ni comparte nada), y la declaración del servicio en primer plano (tipo
      "reproducción de medios": leer libros en voz alta con la pantalla apagada).
- [ ] Ya está: Android objetivo 36, `docs/brand/store/icon_512.png` (512×512, sin transparencia) y
      `docs/brand/store/feature_graphic.png` (1024×500), verificados.

### Fase 4 — Prueba cerrada y producción (Facu)

- [ ] Las cuentas personales creadas después de noviembre de 2023 tienen que hacer una **prueba
      cerrada con al menos 12 personas durante 14 días seguidos**. Juntar los 12 (amigos, familia),
      crear la pista de prueba cerrada, subir el AAB, mandar el link de invitación.
- [ ] Durante esos 14 días: cada bug que salga se arregla y se sube una versión nueva (el
      `versionCode` sube, los 14 días no se reinician).
- [ ] Pedir acceso a producción, contestar el cuestionario de Google, esperar la revisión (de horas
      a días) y publicar.

---

## El resaltado de la voz en la página (2026-09-24)

Facu: "no muestra por dónde va". Estaba (B10) y nunca se sacó, pero probado con un libro impreso
de verdad ("Alas de sangre", 552 páginas) aparecieron tres cosas que en el PDF de prueba no se veían:

1. **Casi invisible.** Usaba el color de resaltado del texto, que es un tono del papel: sobre una
   página oscura (noche, noche cálida) no se distinguía. Ahora es lacre translúcido (38 %), que se ve
   sobre los cuatro papeles y deja leer.
2. **Las últimas palabras de cada página no se resaltaban.** La página "de la voz" va 80 caracteres
   adelantada para pasar la hoja a tiempo; la búsqueda usaba esa página, así que el final de cada
   página se buscaba en la siguiente y no se encontraba (7 de cada ~250 palabras en el log). Ahora la
   palabra se busca en SU página y los rectángulos viajan con su número de página.
3. **Corrido una letra a la derecha.** El texto de la página se plegaba sacando las marcas de acento;
   cuando el PDF guarda una tilde como carácter aparte, el plegado queda una posición más corto que
   el original y todas las cajas de ahí en adelante se piden corridas. Ahora el plegado lleva un mapa
   índice plegado → índice original. De paso pliega ligaduras ("ﬁ" → "fi"), guiones blandos y el
   guión de fin de renglón ("pala-" + salto + "bra"), que son las otras formas en que una palabra del
   libro no se encontraba en su página.

Verificado en el emulador sobre el libro real, en tema cálido y en día: la palabra que suena queda
marcada exacta, también al final de la página.

---

## Las carpetas escaneadas: refresco y orden (2026-09-24)

Facu, desde el teléfono: "cuando se carga una carpeta y se le agregan libros, la carpeta no se
actualiza en la app; ni borrándola y cargándola de nuevo se ven los libros", y "falta poder organizar
las carpetas una vez cargadas".

### Por qué no aparecían

1. **El escaneo automático corría sólo al volver al Inicio, y como mucho cada dos minutos.** Copiás
   libros a la carpeta con el explorador de archivos, volvés a Bardo, y el Inicio no mira la carpeta:
   nada le avisa que hay archivos nuevos. Reproducido en el emulador: archivo nuevo en la carpeta,
   volver a la app, "100 libros"; aparecía recién al cerrar la app del todo.
2. **Quitar la única carpeta y volver a agregarla tampoco escaneaba.** Con la lista vacía el Inicio
   salía antes de anotar la clave de "qué carpetas escaneé"; al volver a agregar la misma carpeta la
   clave era la de siempre y el intervalo se comía el escaneo. Es exactamente el "ni borrándola y
   cargándola de nuevo".
3. **No había forma manual de escanear**, ni aviso cuando una carpeta autorizada no se podía leer
   (permiso perdido, tarjeta que no está): el escaneo lo mandaba al log y nada más.

### Qué se hizo

- **Volver a la app desde otra escanea siempre** (`AppState`). Es el caso de todos los días: copiar
  libros y volver. Barato: una consulta nativa por carpeta, y los archivos conocidos se saltean por URI.
- **Tirar para abajo en la biblioteca escanea a pedido y dice qué pasó:** "1 libro nuevo o movido",
  "Sin novedades", o "No se pudo leer <carpeta>. Quitala en Ajustes y volvé a agregarla".
  `scanLibraryFolders` ahora devuelve `{ changed, unreadable }` en vez de un número.
- **La clave de carpetas se anota siempre**, también con la lista vacía: quitar y volver a agregar
  escanea ya.
- **Ajustes: flechas para subir y bajar cada carpeta.** El Inicio muestra las secciones en ese orden
  (ya lo hacía: `librarySections` recorre `settings.libraryFolders`). `moveLibraryFolder` en
  `libraryFolders.ts`, con tests. Las flechas sólo aparecen con más de una carpeta.

Verificado en el emulador, con la build x86_64:

- Archivo nuevo en la carpeta + volver del fondo: aparece al instante (100 → 101).
- Tirar para abajo con un archivo nuevo: aviso "1 libro nuevo o movido." y 102; tirar de nuevo:
  "Sin novedades".
- Una sola carpeta: quitarla, agregar un archivo, volver a agregar la MISMA carpeta: aparece (103 → 104).
- Bajar una carpeta en Ajustes: el Inicio cambia el orden de las secciones.

Pendiente en el teléfono de Facu: instalar la build nueva y repetir lo mismo con su carpeta real.

---

## Reabrir un PDF "volvía más adelantado" (2026-09-24)

Facu: "cuando se está escuchando un libro y el usuario cierra la aplicación, con o sin pausar la voz,
al volver a abrir vuelve más adelantado". Reproducido en el emulador con "Alas de sangre" mirando la
fila de `reading_progress` en cada paso. Eran dos fallas encadenadas, las dos en la apertura en dos
tiempos de un PDF con caché (primero el documento provisorio "Página 1, Página 2…", después el texto):

1. **"Escuchar" arrancaba sobre el provisorio.** El efecto que enciende la voz en modo "Escuchar" no
   esperaba al texto real: la voz leía "Página 80, Página 81…" a una por segundo y el progreso se
   guardaba con esas coordenadas (`textLength` 6514 en vez de 1.099.428). En 20 segundos la fila iba de
   la página 80 a la 95 con la pantalla quieta en la 80. Al reabrir: página 96.
2. **Al llegar el texto real se retomaba en el MEDIO de la página.** `positionForPage` devuelve el
   medio de la página (a propósito, por las páginas vacías), y el lector la usaba siempre, aunque el
   progreso guardado tuviera el carácter exacto medido sobre ese mismo texto. Cada reapertura corría
   la lectura hasta media página, con o sin voz. Encima, durante el provisorio el guardado pisaba la
   fila exacta con una que sólo sabía la página.

### Qué se hizo

- `positionWhenTextReady` (`progressRemap.ts`, con tests): al llegar el texto manda el salto pendiente
  si lo hay; si no, la posición exacta guardada cuando cae en la página que se ve; si no, esa página.
- El lector no guarda progreso mientras el documento es provisorio, salvo que pases a OTRA página.
- El modo "Escuchar" espera al texto real. Guardas defensivas: el controlador no reproduce un
  provisorio (avisa que el texto se está preparando) y el servicio de audio no guarda progreso sobre uno.
- Al pasar de página con la voz parada, si la posición actual ya cae en esa página no se mueve al
  medio (`scrollToPage` avisa siempre, también en un salto exacto).
- De paso: un salto (índice, cita, marcador) que llegaba con el provisorio caía en la última página,
  porque se medía sobre el texto de relleno. Ahora se guarda y se aplica sobre el texto real; mientras
  tanto se abre en la página que le toca según el mapa de páginas del caché.

Verificado en el emulador, build x86_64, sobre el PDF real: "Escuchar" desde el Inicio avanza sobre el
texto real (813/123 → 817/70 en 28 s, misma página); cerrar mientras suena y reabrir con "Continuar":
fila idéntica; retomar la voz, pausar, cerrar y reabrir: fila idéntica.

---

## Tablet e iOS (2026-09-24)

### La tablet: por qué no se instalaba

La APK que va al Escritorio se compila sólo para `arm64-v8a` (`-PreactNativeArchitectures=arm64-v8a`),
para que pese 48 MB en vez de más del doble. Una tablet de 32 bits (`armeabi-v7a`: muchas tablets
baratas y casi todas las de hace unos años) o una con procesador Intel (`x86`, `x86_64`) no tiene esas
bibliotecas nativas y Android la rechaza con "No se instaló la app". No es una limitación del código:
ninguna dependencia nativa es exclusiva de 64 bits (Pdfium `io.legere:pdfiumandroid` y
`7-Zip-JBinding-4Android` traen las cuatro ABIs) y `android/gradle.properties` ya las lista todas.

- **Solución:** una APK universal, compilada sin el flag (`./gradlew assembleRelease`), con las cuatro
  ABIs. Va al Escritorio como `Bardo-2.0.0-universal-<fecha>.apk`, al lado de la arm64 (más chica,
  para el teléfono). Para Google Play esto no importa: se sube un AAB y Play le da a cada dispositivo
  sólo lo suyo.
- **Si igual no se instala, en este orden:** Android 7.0 o más nuevo (API 24, `sdkVersion:'24'` en
  la APK); "instalar apps desconocidas" habilitado para el explorador de archivos que abre la APK;
  espacio libre; y si la tablet tenía una versión anterior con otra firma, desinstalarla primero.
- **Lo que ya está bien:** la orientación es libre (`orientation: default`), así que en la tablet se
  puede leer apaisado y la interfaz se acomoda al ancho. La APK declara `supports-screens` chico a
  extragrande.
- **Mejoras pendientes para tablet (no bloquean):** dos páginas por pantalla en apaisado; más
  columnas en la grilla de la biblioteca cuando el ancho lo permite; probar con un AVD de tablet.

### iOS: qué hace falta y en qué orden

**Lo que ya sirve tal cual.** Todo el JavaScript: las pantallas (Expo Router), la base SQLite y sus
migraciones, los parsers de EPUB/TXT/DOCX (el EPUB tiene respaldo en JS con `jszip` cuando no está el
módulo nativo; DOCX usa `mammoth`), el respaldo, las estadísticas, y `expo-audio` en segundo plano con
controles en la pantalla de bloqueo (el plugin ya pide `UIBackgroundModes: audio`).

**Lo que no existe en iOS.** Los cuatro módulos nativos son Kotlin. Cada `expo-module.config.json`
dice `platforms: ["android"]`; para iOS cada uno necesita una implementación en Swift y un `.podspec`,
con el MISMO contrato que ya usa el JavaScript (así el resto de la app no cambia).

| Módulo | Hoy (Android) | En iOS | Esfuerzo |
| --- | --- | --- | --- |
| `bardo-pdf` | `PdfRenderer` + Pdfium: dibujar páginas, texto por página, índice, coordenadas de la palabra, caja de contenido, color de tapa | **PDFKit** (del sistema): `PDFPage.draw(with:to:)` o `thumbnail(of:for:)` para dibujar; `PDFPage.string` para el texto; `characterBounds(at:)` y `selection(for:)` para las coordenadas; `PDFDocument.outlineRoot` para el índice; `bounds(for: .cropBox)`. Riesgo: PDFKit puede ordenar el texto distinto que Pdfium, así que los offsets del caché difieren por plataforma; no importa porque el caché es por dispositivo, pero un respaldo con progreso por caracteres se retoma por página (`resolveSavedPosition` ya lo contempla con `textLength`). | M-L: 1 a 2 semanas |
| `voice-synthesizer` | `TextToSpeech.synthesizeToFile` → WAV | `AVSpeechSynthesizer.write(_:toBufferCallback:)` → `AVAudioFile` (CAF o WAV). Existe desde iOS 13. Hubo fallas conocidas: errores en iOS 16 y audio entrecortado en iOS 17 con ciertos formatos, así que hay que probar con las voces del sistema en un iPhone real desde el primer día. Plan B si una voz no escribe a archivo: `speak` directo (se pierde el retroceso fino y el segundo plano queda más frágil). Voces: `AVSpeechSynthesisVoice.speechVoices()`. | M: 1 semana |
| `bardo-archive` | `java.util.zip` + 7-Zip (zip, rar, 7z, tar), listado de carpetas SAF, huella de contenido, HTML → texto | Zip: `ZIPFoundation` (Swift, MIT) o `Compression` de Apple. RAR, 7z y tar: `libarchive` (está en el SDK de iOS, sin cabeceras públicas: se compila aparte) o las fuentes C de 7-Zip. Huella: `CommonCrypto` (SHA-256 de los primeros 256 KB, misma fórmula). HTML → texto: portar `HtmlText.kt` (200 líneas) o usar el respaldo JS. | M-L |
| `bardo-keys` | Teclas de volumen para pasar página | **No existe.** Apple rechaza las apps que reasignan los botones de volumen (guía de revisión 2.5.9). En iOS la opción se oculta. | 0 |
| Carpetas (SAF) | `requestDirectoryPermissionsAsync` + `listDocumentTreeAsync` | No hay SAF. `UIDocumentPickerViewController` con `.folder` y un *security-scoped bookmark* guardado para volver a entrar en cada arranque (`startAccessingSecurityScopedResource`), `FileManager` para listar. `expo-document-picker` no elige carpetas: módulo propio chico en Swift. Para arrancar alcanza con importar archivos de a uno con el selector de Archivos, que ya funciona. | M |

**Toolchain sin Mac.** EAS Build compila iOS en la nube desde Windows. Para instalar en un iPhone
real hace falta la cuenta de Apple Developer (US$ 99 por año) y se distribuye por TestFlight (o ad
hoc, con el UDID del teléfono). Los builds de simulador no sirven sin Mac; Expo ofrece simuladores
en la nube, a evaluar. Mínimo iOS 15.1 (Expo SDK 55). Cada build de iOS es un build en EAS: se pide
permiso antes, como con cualquier build o deploy.

**Orden propuesto.**

0. **Decisiones de Facu, antes de tocar nada:** ¿hay un iPhone o iPad para probar? ¿Se paga la
   cuenta de Apple Developer? Sin las dos cosas no se puede ver nada corriendo.
1. **Base, sin nativo (1 a 2 días):** que la app arranque en iOS con libros de texto (EPUB, TXT,
   DOCX) y sin voz. Guardas para que ningún `requireNativeModule` tire, SAF sólo en Android, ocultar
   las teclas de volumen, primer build EAS de iOS y TestFlight. **Hecho hoy en el código:** la voz y
   las carpetas ya preguntan si el módulo existe antes de usarlo, y `app.json` tiene la config
   mínima de iOS (documentos en el lugar, sin cifrado exento).
2. **Voz** (`voice-synthesizer` en Swift): es lo que define a Bardo.
3. **PDF** (`bardo-pdf` con PDFKit).
4. **Carpetas con bookmarks y archivos** (cómics): `bardo-archive`.
5. **Pulido iPad** (dos páginas apaisado) y App Store (privacidad, capturas, ficha).

Fuentes consultadas: documentación de Apple de `AVSpeechSynthesizer.write`, foros de desarrolladores
de Apple sobre `write` en iOS 16 y 17, guía de revisión de la App Store 2.5.9, documentación de Expo
sobre builds de iOS sin Mac y el SDK 55, y la documentación de `react-native-documents` sobre
bookmarks de carpetas en iOS.

---

## Pasada de bugs de la misma familia (2026-09-25)

Facu: "hacé una pasada en busca de errores y bugs de este estilo". Tres revisiones de código en
paralelo, de sólo lectura (lector y voz; biblioteca, ajustes y base; parsers, cachés y módulos
nativos), cada hallazgo verificado después en el código antes de tocarlo. Se arreglaron 29. Todo
pasa tipos, lint y 420 tests; lo que se pudo, se probó en el emulador.

### Lector y voz

- **"Detener la voz" pisaba lo que leíste a mano.** Al descargar el reproductor se guardaba la
  posición del audio aunque estuviera en pausa hacía rato: pausabas en la página 50, leías a mano
  hasta la 60, tocabas "Detener" en el Inicio y volvías a la 50. Ahora sólo guarda si estaba sonando.
- **El temporizador de sueño podía no parar nunca.** Si el "parar" llegaba mientras un tramo se
  sintetizaba, se descartaba en silencio y la voz arrancaba igual. Parar ya no espera turno, y
  pausar invalida la sesión del play en vuelo.
- **El lector aplicaba la posición del audio al documento provisorio** (abrir un PDF con la voz
  sonando en segundo plano): caía en el último bloque y se guardaba "última página, 100 %". Ahora,
  sobre el provisorio no se sincroniza, y al llegar el texto real manda la posición de la voz.
- **`isPlaying` quedaba pegado en "sonando"** si el evento nativo de pausa llegaba después de
  descargar el reproductor: el botón mostraba pausa y pasar páginas no guardaba progreso.
- **Saltar desde el índice, la búsqueda o una nota pisaba la posición exacta** con el principio de la
  página (el aviso de "cambió la página" miraba la posición vieja). La posición nueva se anota
  antes de mover la vista.
- **Un salto con el texto pendiente caía en la última página** y sintetizaba audio de "Página N".
  Ahora espera al texto y mientras tanto va a la página correcta con el mapa del caché; "Escuchar"
  pedido desde la ficha con el texto pendiente queda encolado en vez de perderse.
- **La posición "por página" era el MEDIO de la página.** Pasabas páginas a mano y tocabas
  Escuchar: arrancaba a mitad de oración; un PDF recién abierto arrancaba a mitad de la página 1;
  el marcador citaba desde el medio. Ahora es el principio; las páginas vacías las resuelve la
  página guardada junto al progreso.
- **Anotar con el texto pendiente** (cita, marcador, mantener apretado sobre la página) dejaba la
  nota mal ubicada para siempre: ahora avisa "esperá a que termine de preparar el texto", y las que
  ya existan mal ubicadas se re-ubican al llegar el texto.

### Cachés y parsers

- **Re-procesar un PDF movía TODAS las citas al medio de su página**, aunque el texto fuera el mismo
  (pasa solo: el caché en disco guarda 12 libros y evicta el más viejo). Sólo se re-ubican las notas
  cuya posición no cae en su página.
- **La vía rápida del caché no tenía plan B:** si el caché quedó a medias (la app se cerró mientras
  se escribía), el libro abría por páginas pero el texto no llegaba nunca: sin voz ni búsqueda, para
  siempre. Ahora se tira ese caché y se re-extrae de fondo; y el mapa de páginas se escribe al final,
  así un corte ya no deja un huérfano.
- **La poda del caché de páginas borraba la carpeta del libro recién abierto** (arrancaba al cerrar
  el anterior y ordenaba por fecha): páginas en blanco. El libro activo queda excluido.
- **Offsets de página no crecientes** con una página vacía entre una que termina en guion y otra que
  sigue en minúscula (un carácter, pero rompía el invariante). Con test.
- **Capítulos viejos** quedaban en la base si el texto cambiaba y ya no se detectaba ninguno.

### Biblioteca, ajustes y base

- **Renombrar un libro (o escribir su resumen) se perdía al re-procesarlo:** los metadatos del PDF o
  EPUB pisaban lo tuyo. Ahora título y resumen sólo se rellenan si están vacíos.
- **"Restaurar ocultos" desde Ajustes no los mostraba** (el Inicio había escaneado hacía menos de dos
  minutos). Pide un escaneo inmediato.
- **Bucle de cierres con "reabrir el último libro al iniciar":** si un libro tiraba la app al cargar
  por el archivo (no por el caché), cada arranque lo reabría solo. Tras un arranque recuperado no se
  reabre.
- **Importar un respaldo dejaba los ajustes viejos en pantalla** hasta reiniciar (letra, tema, orden,
  meta). Se recargan al terminar. Y sólo entran claves de ajustes conocidas.
- **Las tapas que fallaban se reintentaban en cada vuelta al Inicio** (abrir cada archivo de nuevo,
  nativamente, para nada). Las fallidas se recuerdan en la sesión.
- **"Empezar de nuevo" se deshacía solo si ese libro estaba sonando** (el reproductor volvía a guardar
  su posición). Primero se para.
- **Un archivo de más de 8 MB renombrado quedaba duplicado**, con la copia vieja muerta: sobre ese
  tamaño la huella era nombre+tamaño. Con el módulo nativo (lee 256 KB por stream, sin cargar el
  archivo) ahora la huella es por contenido también para los grandes; los ya guardados con el id
  viejo se reconocen por ese id al moverlos, y al importarlos de nuevo.
- **Importar a mano un libro que ya estaba en una carpeta escaneada** lo duplicaba dentro de la app
  (un cómic de 300 MB) y lo sacaba de su carpeta. Se abre el que está.
- **Relocalizar un archivo movido, o abrir un content:// sin seek con copia local,** pasaba por
  `saveBook` y pisaba `lastOpenedAt` (el libro se caía de "Seguir leyendo") y anulaba el color de
  tapa. Ahora sólo se corrige la ruta (`relocateBook`).
- **"N libros ocultos" para siempre** después de borrar un libro importado a mano. Sólo se ignora si el
  archivo es del usuario.
- **Tras reabrir la base** (`withDatabaseRetry`) la conexión nueva corría sin `foreign_keys`: borrar un
  libro dejaba notas, capítulos y colecciones huérfanos. Los PRAGMA van por conexión.
- **Filtro por una colección borrada** quedaba pegado con la lista vacía. Vuelve a "Todos".

### Quedó anotado, sin tocar (mejoras, no bugs)

- Un solo ejecutor nativo para extraer texto, resaltar y citar: el resaltado de la voz espera detrás
  de una extracción de fondo de otro libro.
- El filtro de color de las páginas duplica el bitmap; con zoom (4096 px) es mucha memoria.
- `withoutText` (PDF protegido o enorme) no se cachea: cada apertura re-extrae.
- Cambiar la voz mientras suena tira el tramo precalentado; `prewarm` usa la voz general y no la del
  libro.
- Pausar escribe el progreso tres o cuatro veces.
- Durante el anuncio de capítulo, tocar el botón de reproducir descarta el salto.
- Quitar una carpeta no saca sus libros ni libera el permiso; excluir una subcarpeta no oculta lo que
  ya entró; no hay "quitar los libros cuyo archivo ya no está".
- El escaneo re-hashea en cada pasada los archivos ignorados y los duplicados.
- `updateSettings` con forma funcional para que dos toques rápidos en un Stepper no se pisen.
- Entradas EPUB de más de 48 MB se saltean en silencio.
