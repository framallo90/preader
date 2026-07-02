# Análisis integral — intelliReader / PDFacuReader
*Revisión sin tocar código · 1 de julio de 2026*

Se leyó toda la documentación (CLAUDE.md, README, PLAN.md, preader-plan.md, SUPABASE_SETUP.md) y el 100% del código (`app/`, `src/`, `supabase/functions/`), más los assets de marca. `npm run typecheck` pasa sin errores: todo lo listado abajo es de lógica, runtime o negocio.

---

# 1 · ERRORES

## 🔴 Nivel crítico (rompen la app o el negocio)

**1.1 — Mismatch de schema: `parsed_document_cache`.**
`database.ts` crea la tabla con columna `bookId`, pero `parsedDocumentRepository` consulta e inserta `documentId`. En una instalación nueva, toda lectura/escritura del cache lanza "no such column". Como `reader.tsx` hace `await parsedDocumentRepository.getParsedDocument(...)` dentro del `try` principal, **el lector no puede abrir ningún documento** en un install limpio.

**1.2 — Mismatch de schema: `chapter_context`.**
La tabla define `characters` y `keyEvents`; el repository usa `charactersJson` y `keyEventsJson`. Guardar contexto de capítulo falla siempre → banner de "lo anterior", pantalla de contexto y chat companion quedan sin datos de forma permanente.

**1.3 — Chunks de TTS exceden el límite de OpenAI.**
`buildSynthesisChunks` arma tramos de hasta 12.000 caracteres, pero la API `/v1/audio/speech` acepta máximo **4.096 caracteres** por request. La Edge Function `tts` pasa el texto sin dividir → error 400 en casi todos los tramos. La reproducción premium no funciona con textos reales.

**1.4 — Preprocesamiento con Claude trunca el texto.**
`callClaude` usa `max_tokens = 1024` (~3.500 caracteres de salida) pero recibe tramos de ~12.000. Aunque 1.3 se arregle, Claude devuelve el tramo cortado → se pierde contenido del libro en el audio y se rompe el mapeo audio↔texto.

**1.5 — Webhook de pago: el plan anual regala solo 1 mes, y el premium nunca expira.**
`mp-webhook` hace `premium_until = hoy + 1 mes` sin mirar qué plan se pagó (el anual de $3.999 recibe lo mismo que el mensual). Peor: **nada verifica `premium_until`** — ni las Edge Functions ni el cliente — así que un solo pago de $499 da premium de por vida. Además el checkout de MP es un pago único, no una suscripción (`preapproval`): no hay recurrencia real.

**1.6 — Deep links de pago rotos.**
`app.json` define `scheme: "intelli-reader"` pero `create-payment` usa `back_urls: "pdfacureader://..."`. Al completar el pago, MercadoPago no puede volver a la app.

**1.7 — Paquetes esenciales sin instalar.**
`jszip`, `mammoth`, `expo-speech`, `expo-secure-store` solo existen como stubs de tipos. El typecheck pasa, pero Metro no puede resolver los imports reales: **la app no buildea** hasta correr el `npx expo install` pendiente.

## 🟠 Nivel alto

**1.8 — `onAuthStateChange` te expulsa del lector.**
En `_layout.tsx`, *cualquier* evento de sesión (incluido `TOKEN_REFRESHED`, que ocurre solo cada ~1 hora) ejecuta `router.replace('/')`. Un usuario escuchando un capítulo es devuelto a Home sin aviso. Además `premiumService.initialize()` se llama en cada evento sin teardown previo → canales Realtime duplicados (leak).

**1.9 — Cleanup del reader corre en cada render.**
`useEffect(() => () => { void reader.shutdown(); ... }, [reader])` en `reader.tsx`: `reader` es un objeto nuevo en cada render, así que el cleanup ejecuta `shutdown()` (escritura a SQLite) y `deactivateKeepAwake()` en **cada render**, peleándose con el efecto que activa keep-awake.

**1.10 — Free tier sin ruta de audio.**
`documentAudioPlaybackService` llama a OpenAI TTS incondicionalmente. Un usuario gratuito toca "Escuchar" y recibe un 403 ("Se requiere cuenta Premium") como error de voz. `nativeTtsService` existe pero nadie lo usa. (Ya documentado como pendiente, pero es el bug de experiencia más costoso: el 100% de los usuarios nuevos ve un error en su primera acción.)

**1.11 — Escrituras a SQLite cada 250 ms en pausa.**
`handlePlayerStatus` persiste con `force = !status.playing`: mientras el player está pausado, cada tick de status (250 ms) fuerza un write idéntico, saltándose el throttle de 1.500 ms.

**1.12 — Webhook frágil e inseguro.**
Con `topic=merchant_order` se consulta `/v1/payments/{id}` con un id que no es de pago → falla silenciosa. No valida la firma `x-signature` de MP, no valida el monto pagado contra el plan, no es idempotente (no registra pagos procesados) y solo lee query params (los webhooks nuevos de MP mandan JSON en el body).

**1.13 — Model string dudoso.**
`CHAT_MODEL = 'claude-sonnet-4-6'` no es un identificador de modelo válido de Anthropic (los válidos son p. ej. `claude-sonnet-4-5` / `claude-sonnet-5`). El chat devolvería 404 del API. Verificar contra la lista actual de modelos.

**1.14 — Edge Function `claude` es un proxy abierto.**
Reenvía el body tal cual a Anthropic sin validar `model` ni `max_tokens`: cualquier usuario premium puede usarla como proxy general de Claude a tu costo. Tampoco hay límite de uso por usuario en `tts` (cada tramo de 12k chars cuesta ~USD 0,36 de tu bolsillo).

## 🟡 Nivel medio

**1.15 — Drift de offsets en el highlight.** `buildTextBlocks` y `buildSynthesisSegments` re-unen oraciones con espacios simples; si el texto original conserva `\n` simples dentro de párrafos (típico de PDF), `indexOf` falla y cae al cursor → los `startChar` derivan. Sumado a que Claude *modifica* el texto antes del TTS (borra pies de página, une palabras), el mapeo lineal tiempo→carácter acumula error visible en el resaltado de palabra.

**1.16 — Contexto de capítulo con solo 8k caracteres.** `reader.tsx` recorta a 16k pero `extractChapterContext` vuelve a cortar a 8.000. Un capítulo de ASOIAF (~15–30k chars) se resume viendo solo el primer tercio.

**1.17 — Cache huérfano al borrar libros.** `parsed_document_cache` no tiene FK con `books`; `removeBook` cascadea capítulos y progreso pero deja el texto completo cacheado ocupando storage.

**1.18 — Dos esquemas de `documentId`.** `filePickerService` usa `createDocumentId` (hash de nombre+fecha+tamaño) pero los parsers y CLAUDE.md dicen "filename". El reader lo pisa con `book.id`, así que funciona, pero la doc miente y los parsers generan ids que nunca se usan.

**1.19 — `chapterId` siempre `null` en `reading_progress`** (tanto en el service como en `persistProgress` del reader); `getChapterAtChar` existe y nadie lo llama.

**1.20 — Mensaje de error desactualizado.** `unsupported_format` dice "el MVP solo admite PDF" cuando ya se soportan 4 formatos.

**1.21 — `POV_CHAPTER_PATTERN` duplicado y frágil.** `SPECIAL_CHAPTER_PATTERN` repite `EPÍLOGO|EPÍLOGO`; la detección exige tab literal `\t` → solo funciona con la conversión específica de lectulandia. Cualquier otro origen del mismo libro no detecta capítulos.

## ⚪ Nivel bajo

- `apiKeys.ts` y la sección del README que instruye poner keys en la app contradicen la arquitectura real (keys solo en Supabase). Borrar ambos: son una trampa de seguridad.
- Código muerto: `voiceSynthesizerService`, `modules/voice-synthesizer`, `recentFilesRepository`, `progressRepository`, `estimateTtsCost` (nunca usado), `getChapterAtChar`.
- `OPENAI_VOICE_OPTIONS` duplicado en `reader.tsx` y `settings.tsx`.
- Strings sin tildes en media app ("Tamano", "Capitulo", "temporizador de sueno") mezclados con strings correctamente acentuados.
- `dist-test/` y `dist-android-check/` commiteados; splash `#E6F4FE` no pertenece a la paleta; `package: com.personal.pdfvoicereader` vs marca intelliReader.
- Falta índice en `chapters(bookId)` y `characters(sagaId)`.

---

# 2 · MEJORAS DE LÓGICA

## Nivel estructural (cambian la arquitectura)

**2.1 — Capa de TTS con estrategia por tier.** Interfaz única `TtsEngine` con dos implementaciones (OpenAI / expo-speech) elegida por `premiumService.isPremium` dentro de `documentAudioPlaybackService`. Es el eslabón que falta para que el free tier exista de verdad.

**2.2 — Chunking alineado al límite real.** Bajar `MAX_CHUNK_CHARS` a ≤4.000 *post-preproceso*, cortando por oración. Mejor aún: preprocesar con Claude primero y chunkear el texto ya limpio, guardando un mapa de offsets original↔limpio para el highlight.

**2.3 — Cache de TTS por hash de contenido.** La key actual `{docId}--chunk-{i}--{voice}` se invalida entera si cambia el chunking o el texto. Con `hash(texto_procesado)+voice+model` el cache sobrevive a refactors y evita resintetizar (= plata).

**2.4 — Cachear también el texto preprocesado por Claude.** Hoy, si el MP3 no está pero el preproceso sí se hizo antes, se paga Claude de nuevo. Tabla `preprocessed_chunks(hash, text)`.

**2.5 — Expiración de premium en el servidor.** Las Edge Functions deben chequear `is_premium AND premium_until > now()`; un cron (pg_cron) que apague `is_premium` vencido; y el webhook debe registrar cada pago en una tabla `payments` (idempotencia + auditoría + monto + plan) y sumar el período correcto según el plan.

**2.6 — Cuotas de consumo.** Tabla `usage(user_id, month, tts_chars, claude_tokens)` actualizada por las Edge Functions con un tope mensual por usuario. Sin esto, el punto 3.1 (economía) es incontrolable.

**2.7 — Migraciones versionadas de SQLite.** `PRAGMA user_version` + lista de migraciones. Los dos bugs críticos de schema (1.1, 1.2) son consecuencia directa de no tener esto: el `CREATE TABLE IF NOT EXISTS` nunca corrige tablas viejas.

**2.8 — Sacar la extracción de contexto del `useEffect` del reader.** Hoy vive dentro del componente (se pierde si cerrás la pantalla, se re-dispara al saltar capítulos con el slider). Debe ser una cola en un service singleton: `contextExtractionQueue.enqueue(chapterId)` con reintentos.

## Nivel medio (calidad y rendimiento)

**2.9 — `buildSynthesisChunks` se recalcula en cada `ensureChunkLoaded`** (incluye cada avance de chunk). Calcularlo una vez por documento y memoizar.

**2.10 — Mapeo tiempo→carácter por segmento, no lineal por chunk.** Prorratear `currentTime` por la longitud de cada segmento del chunk reduce el error del highlight sin depender de timestamps.

**2.11 — `FlatList` con `getItemLayout`.** `scrollToIndex` sobre miles de bloques de altura variable falla seguido (por eso existe el retry en `onScrollToIndexFailed`). Con alturas estimadas por bloque, la navegación es determinista.

**2.12 — Persistir `chapterId` en el progreso** usando el `currentChapter` ya calculado, y usar eso para "continuar leyendo" con contexto ("Estabas en TYRION (4)").

**2.13 — Transacción única para el upsert de personajes** (hoy N inserts secuenciales tras cada capítulo).

**2.14 — Streaming en el chat (SSE)** — ya identificado en CLAUDE.md; con respuestas de 3-4 párrafos la espera en blanco se siente larga.

**2.15 — Retry con backoff en `synthesizeSpeech` y `callClaude`** (red móvil); hoy un fallo transitorio corta la reproducción.

## Nivel bajo

- Unificar constantes de voces en `src/config/voices.ts`.
- Eliminar los módulos muertos listados en 1.x.
- `welcomeText` del chat miente si el contexto falló por 1.2 ("Conozco los N capítulos…").
- Tests: no hay ninguno; `chapterDetector`, `textBlocks`, `synthesisSegments` y `documentProgress` son funciones puras ideales para unit tests baratos.

---

# 3 · MARKETING Y ESTRATEGIA DE VENTA

## Nivel estratégico (decisiones de negocio)

**3.1 — La economía unitaria está rota; es el problema #1.**
`tts-1-hd` cuesta USD 30 por millón de caracteres. *Juego de Tronos* en español ≈ 1,7M caracteres → **~USD 51 por libro por voz**, más Claude Haiku de preproceso. El plan premium cuesta $499 ARS/mes (≈ USD 0,40). Un solo usuario activo escuchando un libro genera >100× su suscripción en costos. Opciones, de mayor a menor impacto:
- Cambiar de motor: `gpt-4o-mini-tts` (~USD 0,015/1k, la mitad) o modelos on-device de nueva generación (Piper/Kokoro en el teléfono = costo cero marginal, calidad muy superior a expo-speech). El on-device además refuerza el pitch "offline".
- Cuotas duras por plan (p. ej. 150k caracteres/mes ≈ 4 horas de audio) con paquetes extra ("+1 libro").
- Pricing por consumo o por libro ("desbloqueá este libro en audio: $X") en vez de tarifa plana.
Sin resolver esto, cada venta pierde plata: no es un problema de crecimiento sino de supervivencia.

**3.2 — El diferenciador vendible no es el TTS: es el "modo saga".**
TTS de PDFs ya lo hacen Speechify, ElevenLabs Reader y @Voice — competir ahí es competir en costos contra gigantes. Lo que nadie hace bien es el **compañero anti-spoiler**: recap al llegar a un capítulo, wiki de personajes que crece con tu lectura, chat que sabe exactamente hasta dónde leíste. Eso corre sobre Haiku (centavos) y tiene economía sana. Recomendación: invertir el pitch — el producto es "el compañero de lectura para sagas densas", y las voces IA son el add-on. Esto también reordena el roadmap: la wiki de personajes (pendiente) pasa a ser prioridad de producto.

**3.3 — Distribución y pagos: conflicto con Google Play.**
Si la app se publica en Play Store, Google exige Play Billing para suscripciones digitales; el checkout de MercadoPago por browser es causa de rechazo o baja. Decidir explícitamente: (a) Play Store + Play Billing (alcance, −15% comisión), o (b) distribución por APK/web con MP (sin comisión, sin alcance). El estado actual — APK sideload + MP — es válido para la fase amigos/beta, pero el plan de crecimiento necesita esta decisión antes de invertir en ASO.

**3.4 — Riesgo de copyright en la comunicación.**
La documentación y el tuning del parser giran alrededor de PDFs de lectulandia (piratería). Para uso personal es problema del usuario, pero **ningún material de marketing puede mencionar ASOIAF/lectulandia ni mostrar sus textos**. Posicionar como "tus libros y documentos" y usar textos de dominio público (El Quijote, Verne) en screenshots y demos.

**3.5 — Tres nombres conviven: PDFacuReader, intelliReader, PReader.**
"PDFacuReader" es una broma interna (no escala), "intelliReader" es genérico y con conflictos de marca probables. Elegir un nombre propio, verificar dominio + Play Store + marcas, y alinear `app.json`, package id, login, README y brand board. Sugerencia de criterio: que evoque saga/voz/lectura en español (el mercado inicial es hispanohablante).

## Nivel táctico (conversión)

**3.6 — El free tier es el funnel, y hoy está roto (bug 1.10).** El flujo sano: usuario free escucha con voz del sistema desde el minuto uno → toca "probar voz IA" → escucha la diferencia en SU libro → paywall. La conversión de audio se vende con el oído, no con bullets.

**3.7 — Trial de valor, no de tiempo.** Regalar el primer capítulo con voz premium + primer recap IA por libro. Costo acotado (~USD 0,50/usuario) y demuestra las dos features premium a la vez, en el momento de máximo engagement.

**3.8 — Pricing y anclaje.** La pantalla actual lista mensual y anual como iguales. Destacar el anual como "recomendado" con precio mensual equivalente ($333/mes), badge de ahorro en color acento, y garantía simple ("cancelás cuando quieras"). Precios en ARS hardcodeados en la Edge Function = se licúan con inflación; moverlos a una tabla `plans` editable.

**3.9 — Cero analytics.** No hay forma de saber activación, conversión ni retención. Mínimo viable: eventos de import, primer play, error de play, vista de paywall, checkout iniciado/completado (PostHog/Amplitude free tier).

## Nivel de comunicación

**3.10 — ASO/copy.** Keywords donde hay búsqueda real: "leer PDF en voz alta", "convertir PDF a audiolibro", "lector TTS español". El tagline del brand board — *"Tus libros, en voz alta. En tu idioma. A tu ritmo."* — es excelente; usarlo en todo.
**3.11 — El "modo saga" como contenido.** Comunidades de lectores de fantasía (r/fantasy_es, booktok/booktube en español, foros de ASOIAF) son el nicho exacto; un demo de "chat sin spoilers" es contenido compartible por sí mismo.
**3.12 — Screenshots de store** mostrando: word highlight en acción, banner de recap de capítulo, wiki de personajes, modo oscuro. El feature graphic actual no muestra el producto.

---

# 4 · ANÁLISIS VISUAL (marketing visual + psicología)

## Lo que hay

Conviven **dos identidades incompatibles**:
1. **Brand board "Pergamino"** (`brand_board.png`, `feature_graphic.png`): paleta pergamino/bosque/tinta/ámbar, serifs editoriales (Gloock/Lora), motivo de "onda que lee", ícono libro+onda sobre verde. Sofisticada, calma, coherente con leer de noche.
2. **Logo/ícono "R" multicolor** (`Logo/`, `assets/icon.png`): azul+naranja+verde saturados, degradados, play button, fondo celeste `#E6F4FE`. Estética de utilidad PDF genérica (con aspecto de generado por IA), sin relación con la paleta de la app.

El theme in-app (`theme.ts`) ya implementa la identidad 1 — cream `#f7f4ee`, verde `#5f8c84`, modo oscuro bien resuelto con primarios desaturados.

## Veredicto y cambios, por nivel

### Nivel identidad (decisión de fondo)

**4.1 — Adoptar el brand board y descartar la "R" multicolor. Sin dudarlo.**
Psicología del color aplicada al caso: una app de escucha prolongada necesita **baja excitación** — verdes desaturados y neutros cálidos reducen carga cognitiva y comunican "biblioteca, calma, foco"; el arcoíris saturado del ícono actual comunica "herramienta gratuita de conversión de archivos", exactamente la categoría de la que hay que huir para poder cobrar. Además el ícono actual promete "play de video" (play azul) más que lectura. Rehacer el ícono de app con el libro+onda sobre Bosque `#5F8C84` (ya existe en el feature graphic y funciona a 48px), y alinear el splash (`#E6F4FE` → `#f7f4ee`).

**4.2 — Tipografía editorial in-app.** Hoy todo es fuente del sistema. Cargar **Lora** para los bloques de lectura y una display serif (Gloock) para títulos de pantalla/nombre de capítulo conectaría la app con la marca y con el objeto "libro". La serif en el cuerpo de lectura además mejora la sensación de "estoy leyendo un libro, no un ticket". (Bajo costo: `expo-font` + 2 familias.)

### Nivel conversión (psicología aplicada a pantallas)

**4.3 — Reservar el Ámbar `#BE9B5A` como color exclusivo de conversión.** Hoy el CTA de "Suscribirme" usa el mismo verde primario que cualquier botón → no hay jerarquía de deseo. Dorado/ámbar = premium/valor en el imaginario; usarlo SOLO en: botón de suscripción, badge "Ahorrás 33%", badge "✦ Premium activo" y el candado de features premium. La escasez cromática crea el reflejo "dorado = lo bueno".

**4.4 — Paywall (subscription.tsx):** anclar el plan anual (card con borde ámbar, "Recomendado", precio/mes equivalente), íconos por feature en vez de ✓ de texto, una línea de reducción de riesgo bajo el CTA ("Se activa al instante · Cancelás cuando quieras"), y idealmente un reproductor A/B de 10 segundos "voz del sistema vs voz IA" — es el argumento de venta completo sin leer nada.

**4.5 — El banner de capítulo es el momento firma del producto: subirlo de jerarquía.** Es lo único que ninguna app competidora tiene. Hoy es un card discreto. Merece: avatar/inicial del personaje POV con un color estable por personaje (Bran siempre el mismo tono), micro-animación de entrada, y el "Ver contexto completo →" como botón, no como link chico. Cada aparición del banner es un recordatorio de por qué pagar.

**4.6 — Play como héroe del reader.** El botón principal ("Escuchar/Pausar") comparte tamaño y estilo con "Anterior/Siguiente". La acción #1 de la app debería ser un botón circular grande e inconfundible — patrón audiolibro que el usuario ya tiene aprendido de Spotify/Audible.

**4.7 — Login como primera impresión de marca:** reemplazar el texto plano "intelliReader" por el wordmark serif del brand board sobre pergamino. El bloque "Gratis para siempre" está muy bien (reduce ansiedad de registro) — conservarlo.

### Nivel pulido (percepción de calidad)

**4.8 — Tildes faltantes** ("Tamano de fuente", "Capitulo", "sueno", "companion") — en una app *para lectores* la ortografía es parte del producto; esto erosiona confianza justo en el público objetivo.
**4.9 — Estados vacíos y de carga** con el motivo de la onda (ilustración liviana en pergamino/bosque) en vez de texto plano.
**4.10 — Feature graphic:** buena dirección; mejorar contraste de los pills semitransparentes y sumar un screenshot real del reader con highlight visible.
**4.11 — Modo oscuro:** ya está bien resuelto (primarios desaturados, no negro puro). Solo cuidar que el ámbar de CTA tenga variante accesible (contraste AA) sobre `#161915`.

---

## Resumen ejecutivo

| Área | Estado | Lo más urgente |
|---|---|---|
| Errores | 7 críticos | Los 2 mismatches de schema SQLite (la app no abre libros), límite 4096 de TTS, y el webhook que regala premium de por vida |
| Lógica | Base sólida, cableado incompleto | Free tier con expo-speech, cuotas de consumo, migraciones de DB |
| Marketing | Modelo actual pierde plata por venta | Economía del TTS (motor más barato o cuotas) y pivotear el pitch al "modo saga" anti-spoiler |
| Visual | Dos marcas en conflicto | Adoptar el brand board Pergamino, matar la "R" multicolor, ámbar solo para conversión |
