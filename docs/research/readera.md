# ReadEra — cómo funciona por dentro

> Referencia técnica y funcional para comparar con **Bardo**.
> Relevado el **2026-09-21**. Fuentes: sitio oficial, fichas de store, OpenReadEra **y desensamblado del APK real**.
> APK analizado: `org.readera` **26.05.20+2300** (build universal APKPure, 20,6 MB, arm64-v8a).

## Niveles de confianza

- 🔬 **Verificado en el APK** — lo vi en el binario, el manifest, el DEX o los recursos. Es un hecho.
- ✅ **Fuente oficial** — readera.org o ficha de store.
- 🔵 **Inferido** — deducción a partir de evidencia.
- ❓ **Sin datos**.

---

## 0. Correcciones sobre el relevamiento inicial

El APK desmintió cinco cosas que había dado por ciertas leyendo solo material público. Las dejo escritas porque el error es instructivo: **el marketing de ReadEra subvende el producto**.

| Lo que asumí | La realidad | Impacto |
|---|---|---|
| ReadEra no sincroniza audio con la página | 🔬 **Sí lo hace.** El motor expone `speechRectJni` y la vista dibuja `drawSpeech` con los rectángulos de lo que se está leyendo, y `ReadSurface` sigue la posición de voz. | Era "el diferencial de Bardo". **No lo es.** |
| Identifica libros por ruta de archivo | 🔬 **Usa hash de contenido**: la tabla `docs` tiene columna `doc_sha`. | Bardo no era superior acá; están a la par. |
| No tiene diccionario propio, depende de apps externas | 🔬 **Tiene un sistema de vocabulario personal completo**: tablas `dict_words`, `dict_contexts`, `langs`, ~15 diálogos de gestión de palabras, formas, notas y contextos. El texto de UI dice *"Learn foreign words."* | Feature entera invisible en el material público. |
| El paywall no toca ninguna capacidad de lectura | 🔬 **Falso.** Gatea escucha en background, rango de velocidad de voz, voz de notas al pie y saltear encabezados. | Corrige la lectura del modelo de negocio. |
| No hay reflow de PDF | 🔬 **Existe**: `reflowAnalyzeJni` + botón `ToolBarHelper: Click reflow`. | — |

---

## 1. La arquitectura, ahora probada

### 1.1 Los motores son ejecutables disfrazados de librerías

Esto es lo más importante de todo el análisis y estaba solo insinuado en la documentación pública.

En `lib/arm64-v8a/` hay siete archivos `.so`. Leí sus headers ELF:

```
liberapdf.so        ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (4.5 MB)
liberaepub.so       ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (3.8 MB)
liberadjvu.so       ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (1.4 MB)
liberacomic.so      ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (1.1 MB)
liberamobi.so       ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (0.3 MB)
libfontmanager.so   ET_DYN  interp=/system/bin/linker64   -> EJECUTABLE   (0.2 MB)
libreadera.so       ET_DYN  interp=-                      -> libreria     (1.2 MB)
```

🔬 Seis de los siete tienen segmento **`PT_INTERP` apuntando al linker de Android** — eso solo lo tienen los **ejecutables**, nunca una librería compartida. Están nombrados `lib*.so` por una razón concreta: desde Android 10 solo se puede `exec()` binarios que vivan en el directorio de librerías nativas de la app, y Play solo extrae a disco los archivos que matchean `lib*.so`. Por eso el manifest declara `extractNativeLibs="true"` 🔬 — necesitan los binarios en disco para ejecutarlos.

**Solo `libreadera.so` es una librería real**: es el puente JNI.

### 1.2 El mecanismo exacto: fork + mkfifo

Símbolos exportados por `libreadera.so` 🔬:

```
Java_org_readera_jni_JniDoc_forkJni      ← lanza el proceso del motor
Java_org_readera_jni_JniDoc_killJni      ← lo mata
```

Y en sus strings nativos: **`mkfifo`**, **`socket`**, **`waitpid`**, **`orebridge_base`**.

El flujo completo queda así:

```
  App Java/Kotlin (org.readera)
        │  JniDoc.forkJni()
        ▼
  libreadera.so  (JNI, en el proceso de la app)
        │  fork() + exec("liberapdf.so")   + mkfifo()
        ▼
  PROCESO SEPARADO: liberapdf.so
     ├─ MuPDF + FreeType + libjpeg-turbo + jbig2dec + OpenJPEG + orecrop
     └─ habla por named pipes / sockets ── responde páginas, texto, rects
```

**Por qué lo hacen así** — ahora confirmado por las licencias embebidas en el propio APK 🔬 (`assets/*/readme.txt`):

| Motor | Licencia declarada | Basado en |
|---|---|---|
| **EraPDF** | **AGPL-3.0-or-later** | MuPDF, Common CLI viewer interface, FreeType, libjpeg-turbo, jbig2dec, OpenJPEG, **orecrop** |
| **EraEPUB** | **GPL-2.0** | CoolReader, Common CLI viewer interface, FreeType, **Antiword**, **chmlib**, libjpeg, libpng |
| **EraDjVu** | **AGPL-3.0-or-later** | DjVuLibre, Common CLI viewer interface, libjpeg-turbo, orecrop |
| **EraMOBI** | **AGPL-3.0-or-later** | Libmobi, Common CLI viewer interface, libjpeg, libpng |
| **EraComic** | **GPL-2.0** | libjpeg-turbo, libpng, EasyBmp, libwebp, **dmc_unrar**, MiniZip, zlib |

Tres motores son **AGPL**. Si ReadEra los linkeara dentro de su app, tendría que abrir todo el código de la app y no podría vender la versión Premium. Al mantenerlos como **programas independientes que se comunican por IPC**, se apoyan en el argumento de *mere aggregation* de la GPL. **Toda la arquitectura existe para poder vender una app cerrada sobre motores copyleft.** Los beneficios técnicos (un PDF corrupto mata al proceso hijo, no a la app; el heap del parser vive aparte) son reales pero secundarios.

Detalle de color: los `readme.txt` de EraPDF, EraEPUB y EraMOBI dicen todos *"You can get the source code of **the EraDjVu**"* — copiaron y pegaron la plantilla sin corregir el nombre.

### 1.3 La API completa del motor (el contrato real)

Los 54 métodos JNI que exporta `libreadera.so` 🔬 son la mejor descripción que existe de lo que ReadEra sabe hacer:

| Área | Métodos |
|---|---|
| **Ciclo de vida** | `forkJni` `killJni` `openJni` `destroyJni` `setConfigJni` `getOpenReadEraVerJni` |
| **Render** | `pageOpenJni` `pageRenderJni` `pageGetSizeJni` `pageFreeJni` |
| **Texto** | `pageTextJni` `pageSimpleTextJni` |
| **Recorte** | **`pageSmartCropJni`** **`pageSpeechCropJni`** |
| **TTS** | **`speechStartJni`** **`speechTextJni`** **`speechRectJni`** **`pageSpeechIngestJni`** |
| **Búsqueda** | `searchTextJni` `searchCountJni` `searchRectJni` |
| **Posición** | `pageXPathFromCoordsJni` `pageXPathFromIndexJni` `pageXPathFromRectJni` `pageXPathToIndexJni` `pageXPathListToIndexJni` |
| **Estructura** | `getOutlineJni` `getMetaJni` `pageLinksJni` `bookmarkRectJni` |
| **Imágenes** | `getImageJni` `imagesJni` `pageImagesJni` |
| **Fuentes** | `installFontsJni` `fontsAnalyzeJni` `setFontsConfigJni` `setFontLigmapJni` |
| **Reflow** | **`reflowAnalyzeJni`** |
| **Diccionario** | `pageDictCheckJni` `pageDictRegJni` |
| **Cómics** | `rarExtractJni` `rarInfoJni` |
| **Bitmap** | **`applyColorModeJni`** `mallocJni` `copyPixelsJni` `eraseColorJni` `freeJni` |
| **Utilidades** | `getStringStemJni` `freeStemmerJni` `getTextLocaleJni` `getModifyTimeJni` |

Tres cosas que este listado revela y que ninguna fuente pública menciona:

1. **El TTS está integrado al motor de render, no pegado encima.** `pageSpeechIngestJni` le pasa la página al motor, `speechTextJni` devuelve el texto a hablar y **`speechRectJni` devuelve las coordenadas en la página**. Por eso pueden resaltar sobre la página escaneada lo que la voz está diciendo.
2. **El modelo de posición es XPath**, herencia de CoolReader. Convierten entre XPath ↔ índice ↔ coordenadas ↔ rectángulo. Es lo que les permite mantener una posición estable aunque cambien tipografía o tamaño.
3. **Los modos de color se aplican en nativo** (`applyColorModeJni`) sobre el bitmap ya renderizado. Sepia y noche funcionan igual en un PDF escaneado que en un EPUB.

---

## 2. Modelo de datos (tablas y columnas reales)

Extraídas de las consultas SQL embebidas en el DEX 🔬. Usan **SQLite crudo** (`SQLiteOpenHelper`), no Room — Room aparece en el APK pero solo lo usa WorkManager.

### Tabla `docs`

```
doc_id · doc_uri · doc_sha · doc_file_size · doc_format · doc_lang
doc_authors · doc_series · doc_md · doc_modified_time
doc_have_read_time · doc_active · doc_active_count · doc_colls_count
doc_outdated_position
doc_review_new · doc_review_edit_stars · doc_review_edit_text · doc_review_delete
```

- **`doc_sha`** — hash de contenido. Identifican el libro por lo que contiene, no por dónde está.
- **`doc_outdated_position`** — bandera para cuando el archivo cambió y la posición guardada quedó vieja. Hay un diálogo `ShowOutdatedPosDialog` para resolverlo con el usuario.
- **`doc_review_edit_stars`** — las reviews tienen **estrellas**, no solo texto.
- `doc_active_count` / `doc_colls_count` — contadores desnormalizados para que la biblioteca liste rápido. Es la clase de decisión que explica que aguanten 500.000 documentos.

### Tabla `notes` — una sola tabla para todas las anotaciones

```
note_id · note_uri · note_type · note_body · note_data · note_extra
note_index · note_page · note_mark · note_insert_time · note_modified_time
```

🔵 **`note_type` es el discriminador**: marcadores, citas y notas son filas de la misma tabla. Es un modelo simple y es exactamente por qué la pantalla "About Document" puede mostrarlos juntos sin esfuerzo.

### Colecciones

```
colls          : coll_id · coll_child
docs_to_colls  : doc_id · coll_id
```

Relación N:N — un libro en varias colecciones. Y **`coll_child` es el flag del modo infantil** 🔬, probado por esta consulta que está en el binario:

```sql
select ft.doc_id from colls fc, docs_to_colls ft
WHERE fc.coll_id=ft.coll_id and fc.coll_child > 0
```

O sea: **el modo infantil no es un subsistema, es un flag en las colecciones** + un passcode (`READERA_UNLOCK_SCREEN_PASS0/1/2` y `_RESET` 🔬). Elegantísimo: reusaron colecciones para resolver control parental.

### Vocabulario personal

```
dict_words     : word_id · word_key · word_title
dict_contexts  : ctx_id
langs          : lang_id · lang_name
```

---

## 3. El descubrimiento: el diccionario personal

Esto **no aparece en readera.org, ni en Google Play, ni en ninguna reseña** que haya encontrado. Está en el APK 🔬.

Diálogos dedicados que encontré:

```
AddDictWordBehaviorDialog   DictWordBaseDialog        DictWordBehaviorDialog
DictWordSettingsDialog      EditDictBaseDialog        EditDictCommentDialog
EditDictContentsDialog      EditDictFormsDialog       EditDictWordBehaviorDialog
EditDictWordNoteDialog      MergeDictWordsDialog      ShowDictAboutDialog
AddDictContextDialog        DictFiltersDialog         DictPremiumDialog
```

Más strings de UI: `Learn foreign words.` · `Word forms` · `Add word form` · `Dictionary is empty` · y los JNI `pageDictCheckJni` / `pageDictRegJni`.

**Qué es:** un constructor de vocabulario para aprender idiomas. Marcás una palabra mientras leés, queda guardada con sus **formas flexionadas**, un comentario, una nota y el **contexto** (la frase donde apareció). Podés **fusionar entradas** de la misma palabra. El motor **registra palabras por página** (`pageDictRegJni`) y **chequea** cuáles ya conocés (`pageDictCheckJni`), lo que explica que las palabras guardadas aparezcan subrayadas al releer.

El stemmer nativo (`getStringStemJni`) y la detección de idioma (`getTextLocaleJni`) están al servicio de esto.

> 💡 Para un lector personal de libros en inglés, esta es probablemente **la feature más valiosa de ReadEra**, y está escondida.

---

## 4. Qué es gratis y qué es Premium (según la propia app)

Lo que sigue sale de los strings de UI del APK 🔬, no de la web. **La web enumera 6 features Premium; la app gatea 12.**

### Gates confirmados en el binario

| # | Gate | String exacto en el APK |
|---|---|---|
| 1 | Sync Google Drive | *"Synchronization of books, reading progress, quotes and notes"* |
| 2 | Fuentes propias | *"Adding your own fonts is available in ReadEra Premium."* |
| 3 | Sección global Citas y Notas | *"All quotes, notes, bookmarks and reviews from all books and documents are collected in one place."* |
| 4 | Vista de biblioteca configurable | *"Customizable library view"* |
| 5 | Colores de citas | *"Colored quotes and notes"* |
| 6 | Miniaturas de página | *"Thumbnails for all pages of the book being read"* |
| 7 | **Sección global de vocabulario** | *"A single section for all your words is available in ReadEra Premium."* |
| 8 | **Escuchar en background** | *"You can listen to books in the background in ReadEra Premium."* |
| 9 | **Velocidad de voz extendida** | *"Extended speech speed settings: 0.1x - 4x."* |
| 10 | **Voz de las notas al pie** | *"voiceover of footnotes"* |
| 11 | **Saltear encabezados y números de página** | *"the ability to skip reading headers and page numbers"* |
| 12 | **Velocidad individual por voz** | *"Individual speed settings for different voices."* |

Los gates 7 a 12 **no figuran en readera.org/premium**. Cuatro de ellos son de TTS.

**Conclusión corregida:** el núcleo de lectura (formatos, render, anotaciones, colecciones, TTS básico) es gratis de verdad. Pero **escuchar con la pantalla apagada sí está detrás del paywall**, que para un uso tipo audiolibro es la diferencia entre servir y no servir.

---

## 5. Permisos y telemetría (del manifest real)

🔬 `minSdkVersion=16` (Android 4.1) · `targetSdkVersion=36` (Android 16) — **13 años de compatibilidad en un solo binario**.

```
WAKE_LOCK
INTERNET · ACCESS_NETWORK_STATE
READ_EXTERNAL_STORAGE · WRITE_EXTERNAL_STORAGE
MANAGE_EXTERNAL_STORAGE                        ← acceso a todos los archivos
FOREGROUND_SERVICE
FOREGROUND_SERVICE_MEDIA_PLAYBACK              ← TTS en background
POST_NOTIFICATIONS
RECEIVE_BOOT_COMPLETED
com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE
```

Flags de `<application>` 🔬: `largeHeap="true"`, `requestLegacyExternalStorage="true"`, `preserveLegacyExternalStorage="true"`, `allowBackup="false"` (hacen su propio `.bak`), `extractNativeLibs="true"`, `localeConfig` (idioma por app, Android 13+).

**Sin permisos de ubicación, cámara, contactos, micrófono ni publicidad.**

### Telemetría — matiz importante

El APK incluye 🔬: **Firebase Analytics** (`play-services-measurement`), **Firebase Crashlytics**, **Firebase Storage**, **Firebase Auth interop**, **`play-services-ads-identifier`** (Advertising ID) y el **Install Referrer** de Play.

No hay red de anuncios ni SDK de terceros vendedores de datos, y la política de privacidad dice que la telemetría es anónima y desactivable ✅. Pero **`play-services-ads-identifier` + Install Referrer es más recolección de la que sugiere el discurso de "no recolectamos nada"**. Es el stack estándar de atribución de instalaciones, no algo malicioso — pero conviene tenerlo claro.

### Componentes que revelan features

```
org.readera.SpeechService          foregroundServiceType=mediaPlayback
org.readera.MediaBrowserService    exported=true     ← Android Auto / controles de media
org.readera.tier.TierFreeService   permission=org.readera.permission.TierSync
org.readera.tier.TierFreeProvider  permission=org.readera.permission.TierSync
org.readera.TranslatorReceiver · DictionaryReceiver · WebBrowserReceiver
org.readera.{Main,Read,AboutDoc,EditDoc,Prefs,Filepicker,Backup,Unlock,Fonts,Dict,Sync}Activity
```

🔬 **`TierFreeService` + `TierFreeProvider`** responden cómo migran datos entre la app gratis y la Premium: la app gratis **expone un Service y un ContentProvider** protegidos por un permiso propio (`TierSync`), y la Premium los consulta para importar la biblioteca. Era una de mis preguntas abiertas.

🔬 **`MediaBrowserService` exportado** → hay integración con **Android Auto** y controles de media del sistema. Nunca lo mencionan.

---

## 6. Superficie funcional completa

Todo esto verificado en strings de UI del APK 🔬 salvo donde se indique.

**Biblioteca:** auto-detección · escaneo con **carpetas excluidas** (`PrefsExclFragment`, `UndoExclusionDialog`) · listas To Read / Have Read / Favorites · colecciones N:N · agrupación por autor y serie · orden por nombre/formato/última lectura · búsqueda · duplicados · papelera · **gestión de archivos real** (crear carpeta, renombrar, mover, copiar) · **operaciones en lote** (`MultiDocMoveDialog`, `MultiDocCopyDialog`, `MultiDocTrashDialog`, `MultiDocEditAuthorDialog`, `MultiDocEditSeriesDialog`, `MultiDocEditCollDialog`) · manejo de archivos desaparecidos (`TipDisappearedFilesDialog`)

**Lectura:** índice · búsqueda con **stemming** · marcadores · citas con resaltado · notas · **reviews con estrellas** · modos día/noche/sepia/twilight/console aplicados en nativo · **paso de página con botones de volumen** · flip horizontal/vertical · **dos páginas en horizontal** · **modo columna única** · **reflow** · **smart crop** de márgenes · márgenes · brillo bajo el mínimo del sistema · **escritura vertical (CJK)** · notas al pie · miniaturas · `Page underlay`

**TTS:** voces del sistema Android (`TtsEnginePickerDialog`, `PrefsTtsVoiceFragment` con engine/lang/sample text) · velocidad · **temporizador de sueño** (`READERA_PREF_TTS_TIMER`) · **resaltado en página de lo que se lee** · **la vista sigue a la voz** · repetición · `SpeechPauseOnBackgroundDialog`

**Vocabulario:** ver §3

**Traducción/diccionario externo:** apps configurables vía `TranslatorReceiver` / `DictionaryReceiver` / `WebBrowserReceiver`; el menú de selección de texto ofrece copiar, citar, nota, diccionario, traducir, compartir y buscar en web

**Otros:** modo infantil (flag de colección + passcode) · multi-documento en pantalla dividida · backup `.bak` (zip con `library.json`) · sync Drive (Premium) · Android Auto

---

## 7. Lo que ReadEra NO tiene

Ahora que vi el binario, la lista de huecos es mucho más corta y más creíble que la que había armado con material público.

| Hueco | Confianza |
|---|---|
| **Cualquier feature de IA** — sin resúmenes, sin chat, sin contexto | 🔬 Confirmado: nada en el APK |
| **Voces TTS neurales propias** — usa solo motores TTS del sistema | 🔬 Confirmado |
| **Estadísticas de lectura, rachas, metas** | 🔬 Sin rastro en el APK |
| **Detección de capítulos sobre texto plano** — usa el índice del documento | 🔬 Solo `getOutlineJni` |
| **Sync que no sea Google Drive** | 🔬 Solo Drive (`org.readera.auth`) |
| **Versión de escritorio o web** | ✅ No existe |
| **Anotación gráfica de PDF** (dibujar, firmar, formularios) | 🔬 El motor renderiza, no edita |
| **Audiolibros reales** (mp3/m4b) | 🔬 Sin rastro |
| **OPDS / catálogos** | 🔬 Sin rastro |
| **DRM** (Adobe ACSM, Kindle protegido) | 🔵 Ningún motor open source lo maneja |

---

## 8. Fuentes

**APK analizado**
- `ReadEra+–+book+reader+pdf+epub_26.05.20+2300_APKPure.apk` — 20.594.210 bytes
- Evidencia extraída: headers ELF de `lib/arm64-v8a/*`, `AndroidManifest.xml` (parseado a mano desde AXML binario), strings de `classes.dex` + `classes2.dex` (42.999 strings), `resources.arsc` (73.124 strings), `assets/*/readme.txt`, símbolos de `libreadera.so`
- Scripts del análisis: en el scratchpad de la sesión (`elf.py`, `axml2.py`, `dexstr.py`, `binstr.py`, `arscstr.py`)

**Oficiales**
- https://readera.org/ · https://readera.org/premium · https://readera.org/open-readera · https://readera.org/terms · https://readera.org/privacy
- https://play.google.com/store/apps/details?id=org.readera
- https://apps.apple.com/us/app/readera-book-reader-pdf-epub/id1669188337 (iOS: READERA EOOD, v1.2.3, sin IAP)

**Código**
- https://github.com/champignoom/OpenReadEra — espejo de los motores (GPL/AGPL)
- https://github.com/croko22/readera-cites — parser del backup `.bak` / `library.json`

**Datos de escala**
- https://www.appbrain.com/dev/READERA+LLC/ — ~50M instalaciones, rating ~4.85 sobre ~1,37M votos, activo desde 2017
- https://www.apkmirror.com/apk/readera-llc/readera-free-ebook-reader/ — versiones y arquitecturas

**Descartado por contaminación de fuentes**
- Resultados que atribuían a ReadEra el traductor Google incorporado y el selector de diccionario por defecto → son de **Librera Reader**.
- Un issue de estadísticas de lectura atribuido a ReadEra → es de **Readest** (`readest/readest#3155`).
