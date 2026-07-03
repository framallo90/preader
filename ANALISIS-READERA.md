# ReadEra como modelo de trabajo — comparación con intelliReader
*No compara funciones, compara filosofía de funcionamiento · julio 2026*

ReadEra (40M+ descargas, 4,9★) es cerrada, pero su "manera de trabajar" está bien documentada por el sitio oficial y sus notas de versión. Son cinco principios, y cada uno contrasta con una decisión ya tomada en intelliReader.

---

## 1 · Biblioteca por descubrimiento, no por importación

**ReadEra:** nunca le pedís "abrir un archivo". Escanea el almacenamiento en segundo plano (con folders configurables por el usuario), y todo libro que exista o aparezca en el dispositivo entra solo a la biblioteca, ya clasificado (Novedades, Descargas, por autor, por serie). Bajás un EPUB del navegador y cuando abrís la app, ya está ahí. El usuario administra *qué carpetas mira*, no *qué archivos entran*.

**intelliReader:** modelo inverso — `filePickerService` abre el picker del sistema, un archivo por vez. El usuario hace el trabajo de bibliotecario.

**Qué adoptar:** un `libraryScanService`: el usuario elige una o más carpetas (SAF: `StorageAccessFramework.requestDirectoryPermissionsAsync` en expo-file-system), y en cada arranque (o foco de Home) se listan los árboles autorizados filtrando por extensión, y se upsertea en `books` lo nuevo. El picker actual queda como vía secundaria. Esto convierte el Home de "lista de lo que importaste" en "tu biblioteca".

## 2 · No copia archivos: indexa en el lugar

**ReadEra:** "The reader doesn't copy books into its store" — es un pilar explícito de marketing ("Economized memory usage"). El archivo vive donde el usuario lo dejó; la app guarda solo un índice + metadata. Detecta duplicados y agrupa ediciones del mismo título.

**intelliReader:** `copyAssetToDocuments` duplica cada archivo dentro de `documentDirectory/documents` → un libro de 30 MB ocupa 60 MB, y encima el texto completo se guarda una tercera vez en `parsed_document_cache`.

**Qué adoptar:** con carpetas SAF autorizadas se puede leer in-place y guardar solo la URI del documento. La copia interna tiene una virtud real (el picker da URIs temporales), así que el cambio va de la mano del punto 1: con permisos persistentes de carpeta, la copia deja de ser necesaria. Mantener el cache de texto parseado está bien — ese sí es "índice", no duplicado.

## 3 · La identidad del libro es el contenido, no el archivo

**Este es el corazón de lo que te gusta de "cómo guarda en la memoria".**

**ReadEra:** el progreso, marcadores y citas sobreviven a que muevas, renombres o incluso **borres y vuelvas a bajar** el archivo. Eso solo es posible si la clave del libro en su base es una huella del contenido (hash), no la ruta ni el nombre. El estado de lectura es un ciudadano de primera clase, desacoplado del archivo: el archivo puede desaparecer; el estado queda esperándolo.

**intelliReader:** `createDocumentId` = hash de `nombre + lastModified + size`. Renombrás el archivo → otro id. Lo volvés a bajar → otro `lastModified` → otro id. Resultado: progreso perdido, cache de TTS huérfano (¡carísimo!), contexto de capítulos huérfano. Es exactamente la fragilidad que ReadEra decidió no tener.

**Qué adoptar (el cambio de mayor valor/costo de esta lista):**
- `bookFingerprint = hash(primeros 256 KB del archivo + size)` — rápido de calcular, estable ante renombres y re-descargas.
- `books.id = fingerprint`; la URI pasa a ser un atributo *reemplazable* (si el archivo no está, se busca por fingerprint en el próximo escaneo y se re-vincula).
- Todo lo demás ya cuelga de `bookId`, así que progreso, capítulos, contexto y **el cache de MP3 de TTS** (clave `{bookId}--chunk...`) se vuelven inmunes a movidas de archivos gratis. Para el caso TTS esto es directamente plata ahorrada.
- Soft-delete: al borrar un libro de la biblioteca, conservar la fila de progreso/contexto keyed por fingerprint (opcional "borrar todo").

## 4 · Metadata rica: portadas, título y autor reales

**ReadEra:** extrae portada y metadata de cada formato (con extracción de covers optimizada e indexación en background), agrupa por autor y serie, y la biblioteca es una galería visual. El nombre de archivo no importa: `libro_final_v2(3).epub` se muestra como "Juego de Tronos — George R.R. Martin" con su tapa.

**intelliReader:** `RecentDocumentCard` muestra el nombre de archivo crudo y un label de formato. Cero identidad visual del libro.

**Qué adoptar:** en el momento del parseo (que ya existe) extraer también: EPUB → cover del OPF (`jszip` ya está instalado; es leer el item `cover-image` del manifest) y título/autor del `metadata`; DOCX → `docProps/core.xml`; PDF → título de metadata, y para la tapa renderizar la página 1 (lib nativa tipo `react-native-pdf-thumbnail`) o, plan B sin dependencia nueva, una portada generada (color derivado del hash + título tipografiado — estilo editorial que encima pega con tu brand board). Guardar `coverUri`, `title`, `author` en `books` y convertir el Home en grilla de tapas. Es el cambio de percepción de calidad más grande por peso de código.

## 5 · Persistencia invisible y sin cuenta

**ReadEra:** guardado automático de la página al salir, sin botón de guardar, sin registro, sin nube obligatoria. Todo local; el sync con Google Drive es un extra premium *encima* del modelo local, nunca un requisito.

**intelliReader:** la persistencia automática por offset ya la tenés y está bien resuelta (throttle 700 ms, guard de recuperación de crashes — esto está incluso mejor que "a lo ReadEra"). Pero el **login es obligatorio para abrir un PDF local**: `_layout.tsx` redirige a `/login` sin sesión. Es la fricción exacta que ReadEra evita y la razón #1 de abandono en el primer minuto.

**Qué adoptar:** invertir la relación — la app funciona entera sin cuenta (leer, escuchar con voz del sistema, progreso, capítulos); la cuenta aparece solo al tocar algo premium (voces IA, contexto, chat). Auth pasa de guardián a peaje selectivo, igual que el Drive-sync de ReadEra.

---

## Síntesis

| Principio ReadEra | intelliReader hoy | Brecha |
|---|---|---|
| Biblioteca escanea carpetas elegidas | Picker archivo por archivo | Alta |
| Indexa in-place, no copia | Copia todo adentro | Media |
| Identidad = hash de contenido | Identidad = nombre+fecha+tamaño | **Alta (la más valiosa)** |
| Portadas y metadata reales | Nombre de archivo crudo | Alta |
| Sin cuenta; estado local invisible | Login obligatorio; autosave ✔ | Media (autosave ya está bien) |

**Orden sugerido de adopción:** (1) fingerprint de contenido — protege progreso y cache TTS, es la base de todo lo demás; (2) portadas + metadata — máximo impacto visible; (3) escaneo de carpetas SAF; (4) modo sin cuenta; (5) dejar de copiar archivos (consecuencia natural del 3+1).

Lo interesante es que tu arquitectura ya está *orientada* como la de ReadEra — repositorios SQLite por entidad, estado por offset desacoplado de la UI, cache de parseo — el desvío está en tres decisiones puntuales (picker, copia, id frágil), no en el diseño de fondo. Adoptar estos principios no requiere reescribir: requiere cambiar la puerta de entrada de los libros y la clave primaria.

**Fuentes:** [readera.org](https://readera.org/) · [ReadEra en Google Play](https://play.google.com/store/apps/details?id=org.readera&hl=en) · [ReadEra Premium](https://readera.org/premium) · [uptodown — notas de versión](https://readera.en.uptodown.com/android)
