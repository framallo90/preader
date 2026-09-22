# Pasada general: bugs, rendimiento y dónde estamos parados contra ReadEra

**Fecha:** 2026-09-22. **Método:** cuatro revisiones dirigidas en paralelo (módulos nativos Kotlin, utils y componentes, oportunidades de rendimiento, comparación con ReadEra), más medición en el emulador. Todo lo que figura como arreglado se corrigió y se volvió a verificar: tipos estrictos limpios, lint sin problemas, 161 tests.

---

## 1. Bugs de los módulos nativos

Los tres primeros son los que más importan: uno cerraba la app.

1. **Doble rechazo de la misma promesa → la app se cierra.** Cuando el motor TTS rechaza un pedido, avisa **dos veces**: por `onError` (desde un hilo de binder) y por el valor de retorno de `synthesizeToFile`. Las dos rechazaban la misma promesa, y resolver una promesa dos veces lanza `PromiseAlreadySettledException`, que en una build de release **cierra la app**. Se dispara, por ejemplo, si Android vacía la caché entre que se crea la carpeta y se escribe el WAV. Ahora solo rechaza el que logra sacar el pedido del mapa.
2. **El motor de voz quedaba cacheado MUERTO.** Si el teléfono no tiene ningún motor TTS usable, Android ejecuta el aviso de "listo" **dentro del constructor**, antes de que exista la referencia. El código leía la propiedad, veía `null`, daba el inicio por fallido… y al volver el constructor guardaba igual la instancia muerta. Desde ahí, todos los intentos usaban un motor inservible, la lista de voces salía vacía sin explicar por qué, y no se reintentaba nunca — ni después de instalar el motor. Había que matar la app. Ahora la instancia se guarda solo si el inicio salió bien.
3. **La primera vez que tocabas Reproducir se congelaba la pantalla.** Android avisa que el motor está listo desde el hilo principal, y ahí mismo se listaban las voces (cientos de ms) y se arrancaba la síntesis. Eso ahora corre en un hilo aparte.
4. **Un cómic sólido grande bloqueaba todo el módulo de archivos.** Al saltar a una página lejana, la espera de descompresión ocupaba la única cola, y **cerrar el archivo se encolaba detrás de esa misma espera**: si salías y abrías otro libro, el segundo se quedaba cargando hasta que terminara el primero (minutos). Ahora la cancelación no pasa por la cola y la espera se despierta con ella.
5. **Cerrar un cómic sólido podía romper 7-Zip.** Si el hilo de descompresión no moría en 8 segundos, se cerraba igual el archivo nativo **debajo de él**. Ahora, si no termina a tiempo, el cierre se hace después desde un hilo aparte.
6. **Una página dañada dejaba ilegible todo el resto del cómic.** Un error de CRC abortaba la descompresión entera, así que todo lo que venía después de la página rota quedaba inaccesible. Ahora falla solo esa página. (Es el mismo criterio que ya usaba el módulo de PDF con las páginas ilegibles.)
7. **Una página dañada impedía ABRIR un PDF.** Para calcular la proporción típica se muestrean 9 páginas; si una estaba rota, se rechazaba la apertura completa y el libro no abría, aunque las otras 999 estuvieran perfectas.
8. **Páginas muy alargadas nunca se veían.** El ancho del bitmap estaba topeado pero el alto salía del aspecto, sin límite: un mapa o pergamino escaneado (proporción 1:50) pedía ~838 MB y siempre daba "sin memoria". Ahora se topean los dos lados.
9. **Descriptores filtrados con cómics de nombres en codificaciones raras** (scans japoneses): el caso estaba previsto —se reintenta con 7-Zip— pero el archivo zip quedaba abierto. Escanear una biblioteca con varios agotaba los descriptores del proceso.
10. **El marcador de "ya descomprimido" se creía sin verificar.** Si Android vaciaba la caché a medias, esas páginas no abrían nunca más, porque el marcador seguía ahí.

## 2. Bugs de lógica

1. **Capítulo fantasma después de cada encabezado POV.** La marca de "hubo una línea en blanco antes" no se cerraba en esa rama, así que se filtraba a la **primera línea de la prosa** del capítulo, y esa línea entraba al índice partiendo el capítulo real en dos.
2. **Prosa que entraba al índice como capítulo.** El patrón de encabezado genérico aceptaba *cualquier palabra en minúscula* después de "parte", "canto", "sección"…, así que `"Parte superior del cuerpo se movía apenas…"` o `"Section headers were common…"` se tomaban como títulos. En un PDF los renglones vienen cortados a ~70 caracteres y siempre hay una línea en blanco antes de cada párrafo, o sea que las dos guardas se cumplían solas. Ahora lo que sigue tiene que ser un número: cifras, romanos (acotados, para que "mi" o "mil" no cuenten) o un ordinal/cardinal escrito.
3. **El índice de un EPUB grande se parseaba en tiempo cuadrático.** Por cada entrada se copiaba todo el resto del archivo y se volvía a barrer. Con 3.000 entradas eso es cientos de MB movidos, y en Hermes —donde cortar un texto copia de verdad— se nota.
4. **El resaltado de la palabra que suena solo entendía el alfabeto latino básico.** En un libro polaco o checo cortaba la palabra en la primera letra rara ("Kraków" resaltaba solo "Krak") y en ruso o griego no resaltaba nada.

## 3. Rendimiento

1. **El Inicio se redibujaba ~8 veces por segundo y consultaba la base 4 veces por segundo mientras sonaba la voz** — y seguía haciéndolo con el lector en pantalla, porque queda montado abajo. Guardaba el estado completo del reproductor (que incluye el tiempo de reproducción, o sea que cambia siempre) cuando solo muestra qué libro suena y si está sonando. Ahora guarda esos tres datos y solo consulta el libro cuando cambia de libro.
2. **Cada tapa de la biblioteca se reconciliaba en cada pasada.** El componente no estaba memoizado y recibía funciones nuevas en cada render. Con 100 libros eso es reconciliar ~800 vistas por cosas que no tienen nada que ver con los libros.
3. **El libro entero se duplicaba en memoria cada vez que arrancabas la voz.** Al armar los tramos se guardaba el texto de **cada oración del libro**: en un tomo de 3 M de caracteres son ~40.000 strings (~6 MB) que **nadie leía** — la síntesis corta del original cuando le toca a cada tramo. Se guardan solo los rangos. De paso salió a la luz que todo un troceo viejo (`buildSynthesisSegments`/`buildSynthesisChunks`) ya no lo usaba nadie más que sus propios tests: se borró y las garantías que cubría (ningún tramo corta una palabra, todos cierran en fin de oración, cubren el texto sin huecos) se mudaron al troceo que sí se usa.
4. **El lector entero se volvía a evaluar 4 veces por segundo durante la narración**, incluso en modo páginas donde nada de eso se muestra: el rango de la palabra era un objeto nuevo en cada aviso aunque fuera la misma palabra, y el porcentaje cambiaba en el segundo decimal. Los dos ahora conservan el valor anterior cuando no hay cambio real.
5. **La poda del caché de páginas corría en medio del scroll.** Cada 40 páginas revisaba **todos** los archivos del caché (más de mil en un tomo largo), uno por uno. Ahora queda pendiente y se hace al cerrar el libro.
6. **La primera búsqueda en un libro grande congelaba la pantalla.** Plegar tildes llamaba a `normalize()` por cada carácter acentuado y concatenaba carácter a carácter sobre el libro entero. Ahora hay una tabla que se arma una vez. De yapa se pliegan las letras con trazo (ł, đ, ø), que NFD no descompone: buscar "lodz" encuentra "Łódź".
7. **El arranque evaluaba mammoth y JSZip antes de mostrar la biblioteca.** El Inicio importaba el registro de parsers solo para tres funciones de texto, y el registro arrastraba los cinco parsers. La detección de formato se mudó a un módulo sin dependencias (`src/services/bookTypes.ts`) y los parsers se cargan recién cuando abrís un libro de ese formato.

### Medido en el emulador (GPU por software: sirve para comparar entre sí, no en absoluto)

| Escenario | Cuadros con tirón |
|---|---|
| Scroll del modo texto | 38 % |
| Scroll de páginas de PDF | 54 % |
| **Scroll del Inicio** | **55 %** |

Que el Inicio empate con el renderizado de páginas de PDF llama la atención, y tiene una explicación estructural: **la biblioteca no está virtualizada** — se montan todos los libros de una, con su tapa decodificada. Con 16 libros no importa; con 100 son ~800 vistas y decenas de MB de bitmaps en el primer dibujado. Queda anotado como la mejora pendiente de mayor impacto (ver abajo).

## 4. Lo que queda pendiente, por orden de rentabilidad

1. **Virtualizar la biblioteca** (lista con columnas en vez de todo montado). Es el mayor ahorro de memoria y de tiempo de arranque visible, pero toca el agrupado por carpeta: riesgo medio.
2. **Reabrir un PDF cacheado no debería esperar al texto.** La primera apertura ya es instantánea, pero al reabrir se espera a leer todo el texto y materializar todos los bloques antes de dibujar la página 1, cuando para dibujarla solo hace falta el mapa de páginas. La maquinaria para recibir el texto después ya existe; es re-usarla.
3. **Un solo escritor del progreso.** Hoy el servicio de audio y el controlador guardan la misma posición por separado (~2 escrituras por segundo durante toda la escucha).
4. **Bloques con texto perezoso:** cada bloque retiene su propio recorte, así que el libro vive dos veces en memoria.
5. **DOCX:** el archivo queda vivo en cuatro representaciones a la vez y se descomprime dos veces (mammoth y después JSZip solo para leer título y autor).

---

## 5. Dónde estamos contra ReadEra

### Lo que hacemos y ReadEra no (o cobra)

1. **Escuchar con la pantalla bloqueada y en segundo plano, gratis.** En ReadEra es Premium. Para uso tipo audiolibro, es la diferencia entre servir y no servir.
2. **Saltear encabezados y pies repetidos, gratis** — y mejor: comparamos con tolerancia a errores de OCR, así que "MEDITACIONES i%" se reconoce como el mismo encabezado. En ReadEra es Premium.
3. **Detección de capítulos sobre texto plano.** ReadEra solo usa el índice que trae el archivo: en un TXT, o en un PDF sin índice, no te da capítulos. Nosotros sí.
4. **La voz está lista antes de que toques play.**
5. **Retroceder y adelantar 15 s** dentro de la narración, con la velocidad a la vista.
6. **La narración de un PDF suena continua:** se unen los párrafos partidos entre páginas y se saca el guión de la palabra cortada, sin perder la posición de la palabra que se resalta.
7. **"Escuchar" es una acción de primera clase**, no una opción escondida en un menú.
8. **Cero red, cero telemetría, cero permisos.** ReadEra lleva Firebase Analytics, Crashlytics e identificadores de publicidad.
9. **El progreso y las anotaciones sobreviven al re-procesado de un PDF sin preguntarte nada.** ReadEra te abre un diálogo.

### Lo que ReadEra tiene y nosotros no

Por orden de lo que más se usa:

| Qué falta | Costo |
|---|---|
| Zoom con los dedos y ajustar a ancho/alto | grande (pide dependencias nuevas y build nueva) |
| Márgenes de página ajustables | chica |
| Pasar página tocando los bordes | chica |
| Pasar página con las teclas de volumen | media (módulo nativo) |
| Paso de página horizontal (animación de hoja) | media |
| Selección de texto para citar exacto | media (la mitad del trabajo ya está: las notas ya guardan posición y fragmento) |
| Auto-scroll con velocidad | chica |
| Agrupar la biblioteca por autor | chica |
| Tiempo restante de lectura | chica |
| Reflow con imágenes (hoy el modo texto es solo texto) | grande |
| Miniaturas de páginas, dos páginas en horizontal | media |
| Resaltar sobre la página del PDF lo que la voz lee (hoy solo en modo texto) | grande |
| Formatos: ellos 14 (DjVu, MOBI, FB2, CHM…), nosotros 5 + cómics | grande |
| Búsqueda con raíces de palabra (nosotros solo plegamos tildes) | chica-media |
| Papelera, duplicados, operaciones en lote | media |

**Se hizo en esta pasada:** el rango de velocidad de la narración iba de 0,6x a 1,6x, más angosto que el de ReadEra. Ahora va de **0,5x a 3x**, con paso proporcional (fino abajo, grueso arriba) para que recorrerlo no sean veinticinco toques.

**Detectado en la comparación:** la tabla de `bardo-vs-readera-despues.md` seguía diciendo que no teníamos reflow de PDF. Lo tenemos desde el 21/9; la tabla quedó corregida.

### Donde son mejores y conviene no mentirse

- **Formatos:** 14 contra 5 + cómics.
- **Búsqueda:** ellos manejan raíces de palabra; nosotros solo tildes y mayúsculas.
- **Identidad por contenido de archivo** y **que la voz mueva la página**: eso es **paridad**, no ventaja nuestra.
