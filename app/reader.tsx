import Slider from '@react-native-community/slider';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addVolumeKeyListener, setCaptureVolumeKeys } from '../modules/bardo-keys';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { BLOCK_GAP, BLOCK_HORIZONTAL_PADDING, BLOCK_VERTICAL_PADDING, ReaderBlockCard } from '../src/components/ReaderBlockCard';
import { Chip, Icon, IconButton, Row, Sheet, Stepper } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { useReaderController } from '../src/hooks/useReaderController';
import { DocumentParseError, getFriendlyParseErrorMessage } from '../src/services/documentParser';
import { persistBookMetadata } from '../src/services/bookMetadataService';
import { ensureLocalPdfCopy } from '../src/services/libraryScanService';
import { documentAudioPlaybackService } from '../src/services/documentAudioPlaybackService';
import { openPdfQuick } from '../src/services/pdfDocumentParser';
import { PageTextRect, canonicalPageWidthPx, closePdf, getPageTextRects, getTextAtPoint, renderComicCover, renderPdfCover, requestPdfPage } from '../src/services/pdfLocalService';
import { notifyPdfTextReady, preparePdfText, subscribePdfTextProgress, subscribePdfTextReady } from '../src/services/pdfTextPreparationService';
import { readerJumpStore } from '../src/services/readerJumpStore';
import { PdfPageList, PdfPageListHandle } from '../src/components/PdfPageList';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../src/utils/documentProgress';
import { charForPage, pageForChar, pageForProgress } from '../src/utils/pageMap';
import { sentenceSpanAround } from '../src/utils/textSpans';
import { chapterToAnnounce } from '../src/utils/chapterAnnouncement';
import { nextInSeries } from '../src/utils/series';
import { speakAnnouncement } from '../src/services/chapterAnnouncer';
import { detectLanguage } from '../src/utils/languageDetect';
import { findQuoteIndex } from '../src/utils/pageQuote';
import { getDisplayTitle } from '../src/utils/bookDisplay';
import { getParserForDocument, isComicFile, isPdfFile } from '../src/services/parserRegistry';
import { bookRepository } from '../src/storage/bookRepository';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { withDatabaseRetry } from '../src/storage/database';
import { chapterRepository } from '../src/storage/chapterRepository';
import { noteRepository } from '../src/storage/noteRepository';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';
import { AUTO_SCROLL_SPEEDS, Book, BookNote, MAX_TEXT_MARGIN, MIN_TEXT_MARGIN, NoteType, ReadingProgress, ReadingTheme, TEXT_MARGIN_STEP } from '../src/types/storage';
import { ParsedDocument, TextBlock } from '../src/types/document';
import { pagePercentage, positionForPage, resolveSavedPosition } from '../src/utils/progressRemap';
import { buildPagePlaceholders } from '../src/utils/pdfPages';
import { buildTextBlocks } from '../src/utils/textBlocks';
import { resolveChapters } from '../src/utils/resolveChapters';
import { BlockLayoutCache } from '../src/utils/blockLayout';
import { MAX_RATE, MIN_RATE, decreaseRate, formatRate, increaseRate } from '../src/utils/playbackRate';
import { SearchMatch, foldText, searchText } from '../src/utils/textSearch';
import { ThemeColors, getReaderColors, radius, resolveReadingMode } from '../src/utils/theme';

const KEEP_AWAKE_TAG = 'reader-screen';
const READING_THEMES: ReadingTheme[] = ['auto', 'day', 'sepia', 'night'];
const READING_THEME_LABELS: Record<ReadingTheme, string> = { auto: 'Auto', day: 'Día', sepia: 'Sepia', night: 'Noche' };
const MAX_QUOTE_CHARS = 1200;
/** Después de esto, volver al libro merece un recordatorio de dónde ibas. */
const RESUME_HINT_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const DIM_STEP = 0.1;
const MAX_DIM = 0.8;

/** Dónde se quiere anotar: un párrafo (texto) o una página (PDF). */
type AnnotationTarget = { charIndex: number; page: number | null; excerpt: string };
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;
const MIN_LINE_HEIGHT = 1.3;
const MAX_LINE_HEIGHT = 2.0;
const INDEX_ROW_HEIGHT = 48;

/** Hojas del lector: índice, aspecto y voz. Una sola abierta por vez. */
type ReaderSheet = 'none' | 'index' | 'look' | 'audio';

type StatusTone = 'primary' | 'neutral' | 'warning' | 'danger';

/** Título de capítulo para un chip: la primera parte, sin subtítulos largos. */
function shortTitle(title: string, max = 28) {
  const head = title.split(/[.:—–-]\s/)[0].trim();
  return head.length > max ? `${head.slice(0, max - 1).trimEnd()}…` : head;
}

/** Cuánto falta, como "8:43". La frase que lo acompaña la pone quien lo muestra. */
/** "Apagado" · "1" … "5": la velocidad como un número que se entiende. */
function autoScrollLabel(speed: number): string {
  const at = AUTO_SCROLL_SPEEDS.indexOf(speed);
  return at <= 0 ? 'Apagado' : String(at);
}

/** Siguiente (o anterior) velocidad de la lista, sin pasarse de los extremos. */
function stepAutoScroll(speed: number, direction: 1 | -1): number {
  const at = AUTO_SCROLL_SPEEDS.indexOf(speed);
  const next = Math.min(Math.max((at < 0 ? 0 : at) + direction, 0), AUTO_SCROLL_SPEEDS.length - 1);
  return AUTO_SCROLL_SPEEDS[next];
}

function formatRemainingTime(deadlineAt: number | null, now: number) {
  if (!deadlineAt) return null;
  const remainingMs = Math.max(0, deadlineAt - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getStatusColors(colors: ThemeColors, tone: StatusTone) {
  if (tone === 'primary') return { backgroundColor: colors.accent, borderColor: colors.primary, textColor: colors.text };
  if (tone === 'warning') return { backgroundColor: colors.highlight, borderColor: colors.highlight, textColor: colors.highlightText };
  if (tone === 'danger') return { backgroundColor: colors.surfaceMuted, borderColor: colors.danger, textColor: colors.danger };
  return { backgroundColor: colors.surfaceMuted, borderColor: colors.border, textColor: colors.textMuted };
}

export default function ReaderScreen() {
  const { documentId, mode } = useLocalSearchParams<{ documentId?: string; mode?: string }>();
  const { colors, settings, updateSettings } = useAppSettings();
  // El tema de lectura afecta solo al lector (página y texto), no a toda la app.
  const readingMode = resolveReadingMode(settings.readingTheme, settings.darkMode);
  const readerColors = useMemo(() => getReaderColors(readingMode), [readingMode]);
  const [notes, setNotes] = useState<BookNote[]>([]);
  // Las notas al día sin meterlas como dependencia del recordatorio de vuelta.
  const notesRef = useRef<BookNote[]>([]);
  notesRef.current = notes;
  const [annotationTarget, setAnnotationTarget] = useState<AnnotationTarget | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const foldedTextRef = useRef<{ docId: string; folded: string } | null>(null);
  const [documentRecord, setDocumentRecord] = useState<Book | null>(null);
  // Como ref: el toque largo lo lee sin que su callback se rehaga por esto.
  const documentRecordRef = useRef<Book | null>(null);
  documentRecordRef.current = documentRecord;
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [savedProgress, setSavedProgress] = useState<ReadingProgress | null>(null);
  /**
   * "Dónde quedaste": el recordatorio que aparece al volver a un libro después
   * de varios días. Null = no hay nada que mostrar (o ya lo cerraste).
   */
  const [resumeHint, setResumeHint] = useState<{ excerpt: string; notes: BookNote[] } | null>(null);
  const resumeShownRef = useRef(false);
  /** Fecha del último progreso guardado ANTES de esta apertura. */
  const leftOffAtRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Abriendo el libro…');
  // Vista única: SIEMPRE se ve el libro (páginas del PDF o texto) y el audio se
  // controla con la barra flotante + el menú ⋯. No hay "pantalla de escucha".
  const [pdfPageForUi, setPdfPageForUi] = useState(0);
  // Pantalla completa en modo lectura: tocás la página y desaparece el chrome.
  const [isImmersive, setIsImmersive] = useState(false);
  const currentPdfPageRef = useRef(0);
  const appliedInitialPageRef = useRef<number | null>(null);
  const parsedDocumentRef = useRef<ParsedDocument | null>(null);
  parsedDocumentRef.current = parsedDocument;
  const pdfListRef = useRef<PdfPageListHandle>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSleepTimerPickerVisible, setIsSleepTimerPickerVisible] = useState(false);
  const [activeSheet, setActiveSheet] = useState<ReaderSheet>('none');
  // Hay audio cargado para este libro (aunque esté en pausa): muestra el transporte.
  const [isAudioLoaded, setIsAudioLoaded] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  /**
   * Parar cuando termine el capítulo que estás escuchando.
   *
   * Se guarda el CARÁCTER donde termina, no el número de capítulo: es la misma
   * unidad con la que avanza la voz, así que alcanza con mirar si ya lo pasó.
   * `null` = apagado.
   */
  const [stopAtChar, setStopAtChar] = useState<number | null>(null);
  const [sleepDeadlineAt, setSleepDeadlineAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  // Texto del PDF preparándose de fondo (el libro ya se está leyendo): % de avance.
  const [textPrepPercent, setTextPrepPercent] = useState<number | null>(null);
  const listRef = useRef<FlatList<TextBlock>>(null);
  const loadNotesRef = useRef<() => Promise<void>>(async () => {});

  // Pide la página donde va a arrancar la lectura ANTES de que el visor mida su
  // layout: cuando la lista se monta, la imagen ya está dibujada (o en camino).
  // Se lee por ref desde el efecto de carga (que solo corre al cambiar de libro).
  // "Escuchar" pedido desde afuera (ficha del libro) cuando el lector todavía
  // no estaba montado: se arranca la voz apenas el documento esté listo.
  const pendingListenRef = useRef(false);
  // Cómo se va a leer este PDF, leído al abrir (el efecto de carga no depende de
  // los ajustes: cambiar el modo no tiene que recargar el libro).
  const pdfAsTextRef = useRef(settings.pdfAsText);
  pdfAsTextRef.current = settings.pdfAsText;
  const prewarmInitialPageRef = useRef<(book: Book, doc: ParsedDocument, progress: ReadingProgress | null) => void>(() => {});
  prewarmInitialPageRef.current = (book: Book, doc: ParsedDocument, progress: ReadingProgress | null) => {
    if (!doc.pdf || doc.pdf.pageCount <= 0) return;
    const abs = getAbsoluteCharIndex(doc, progress?.blockIndex ?? 0, progress?.charIndex ?? 0);
    const page = pageForProgress(abs, progress?.page ?? null, doc.pdf.pageOffsets, doc.fullText.length);
    const kind = doc.pdf.kind ?? 'pdf';
    const crop = settings.cropPdfMargins ? doc.pdf.crop : null;
    for (const index of [page, page + 1]) {
      if (index >= doc.pdf.pageCount) break;
      requestPdfPage({ bookId: book.id, kind, uri: book.uri, pageIndex: index, widthPx: canonicalPageWidthPx(), colorMode: readingMode, crop }).promise.catch(() => {});
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadDocument = async () => {
      let isGuardArmed = false;
      if (!documentId) {
        setParseError('No llegó un libro válido para abrir.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setLoadingStatus('Abriendo el libro…');
      setParseError(null);
      setSpeechError(null);
      try {
        // Con reintento: si la base quedó inutilizable (la app se actualizó con
        // el proceso vivo), se reabre en vez de dejar el lector en un error sin
        // salida con los datos intactos del otro lado.
        const [book, progress] = await withDatabaseRetry(() =>
          Promise.all([
            bookRepository.getBookById(documentId),
            bookProgressRepository.getProgress(documentId),
          ]),
        );
        if (!book) throw new DocumentParseError('missing_file', 'Este libro ya no está en la biblioteca.');
        // CUÁNDO dejaste de leer, capturado ANTES de que abrir el libro vuelva a
        // guardar progreso: si se leyera después, siempre diría "recién", y el
        // recordatorio de "dónde quedaste" no aparecería nunca.
        leftOffAtRef.current = progress?.updatedAt ?? null;
        void bookRepository.touchBook(book.id);
        // Título disponible ya durante la carga (para el header y para saber qué se abre).
        if (isMounted) setDocumentRecord(book);
        await runtimeStateRepository.armReaderLoadGuard(book.id);
        isGuardArmed = true;
        // Si se pidió abrir en una posición (índice, cita, marcador), gana sobre
        // el progreso guardado.
        // El pedido pendiente trae posición y, a veces, "arrancá escuchando".
        // Se consume UNA sola vez (consumirlo dos veces perdía el segundo dato).
        const withPendingJump = (doc: ParsedDocument, stored: ReadingProgress | null): ReadingProgress | null => {
          const request = readerJumpStore.consumeRequest(book.id);
          if (request?.listen) pendingListenRef.current = true;
          const jump = request?.charIndex ?? null;
          if (jump === null) {
            if (!stored) return null;
            // El progreso pudo medirse sobre otro texto del mismo libro (provisorio,
            // versión anterior): se traduce a una posición válida en ESTE documento.
            const resumed = resolveSavedPosition(doc, stored);
            return { ...stored, blockIndex: resumed.blockIndex, charIndex: resumed.charIndex, percentage: resumed.percentage };
          }
          const pos = getPositionFromAbsoluteChar(doc, jump);
          return {
            bookId: book.id,
            chapterId: null,
            blockIndex: pos.blockIndex,
            charIndex: pos.charIndex,
            percentage: pos.percentage,
            page: null,
            textLength: doc.fullText.length,
            updatedAt: new Date().toISOString(),
          };
        };
        const isPdf = isPdfFile(book.type, book.name);
        const isComic = !isPdf && isComicFile(book.type, book.name);

        // PDF ya procesado antes: se dibuja YA con el mapa de páginas del caché
        // y el texto (voz, búsqueda, índice) entra después. Traer el documento
        // entero para mostrar la página 1 era lo único que quedaba lento al
        // REABRIR un tomo largo; la primera apertura ya era instantánea.
        // Solo cuando se va a leer POR PÁGINAS: en "texto corrido" el texto es
        // justamente lo que se muestra, así que adelantarse no sirve de nada
        // (mostraría el relleno provisorio en vez del libro).
        if (isPdf && !pdfAsTextRef.current) {
          const cachedPdf = await parsedDocumentRepository.getCachedPdfInfo(book.id);
          if (!isMounted) return;
          if (cachedPdf && cachedPdf.pageCount > 0) {
            const placeholders = buildPagePlaceholders(cachedPdf.pageCount);
            const quickDocument: ParsedDocument = {
              id: book.id,
              fileName: book.name,
              sourceUri: book.uri,
              fullText: placeholders.fullText,
              blocks: buildTextBlocks(placeholders.fullText),
              chapters: [],
              // El mapa de páginas es el del caché, pero los offsets son los del
              // texto provisorio: `textPending` avisa que todavía no es el bueno.
              pdf: { ...cachedPdf, pageOffsets: placeholders.pageOffsets, textPending: true },
            };
            const startAt = withPendingJump(quickDocument, progress);
            prewarmInitialPageRef.current(book, quickDocument, startAt);
            setDocumentRecord(book);
            setSavedProgress(startAt);
            setParsedDocument(quickDocument);
            // Y el documento completo, de fondo, por el mismo camino que usa la
            // preparación de texto: entra parado en la página que estás viendo.
            void parsedDocumentRepository.getParsedDocument(book).then((full) => {
              if (full) notifyPdfTextReady(book.id, full);
            });
            return;
          }
        }

        const cachedParsed = await parsedDocumentRepository.getParsedDocument(book);
        if (!isMounted) return;
        // Un PDF cacheado sin mapa de páginas viene de una versión anterior: se
        // re-procesa una vez para tener el lector visual y el seguimiento de voz.
        if (cachedParsed && (!(isPdf || isComic) || cachedParsed.pdf)) {
          // Los capítulos vienen con el caché: nada que detectar ni que escribir.
          // withPendingJump CONSUME el salto pendiente: se llama una sola vez y el
          // resultado se reusa (llamarla dos veces perdía el salto en la segunda).
          const startAt = withPendingJump(cachedParsed, progress);
          prewarmInitialPageRef.current(book, cachedParsed, startAt);
          setDocumentRecord(book);
          setSavedProgress(startAt);
          setParsedDocument(cachedParsed);
          return;
        }
        let effectiveBook = book;
        // Si un content:// no se puede leer donde está (proveedor sin seek), se
        // trabaja sobre una copia local. Lo normal es NO copiar nada.
        const withLocalCopyFallback = async <T,>(open: (uri: string) => Promise<T>): Promise<T> => {
          try {
            return await open(effectiveBook.uri);
          } catch (error) {
            if (!effectiveBook.uri.startsWith('content://')) throw error;
            const localUri = await ensureLocalPdfCopy(book.id, book.uri);
            effectiveBook = { ...book, uri: localUri };
            await bookRepository.saveBook(effectiveBook);
            return open(localUri);
          }
        };

        if (isPdf) {
          // PDF: se abre YA, contando páginas y nada más. El texto (voz, búsqueda,
          // índice) se prepara de fondo y reemplaza a este documento provisorio.
          const quick = await withLocalCopyFallback(openPdfQuick);
          const quickDocument: ParsedDocument = { ...quick, id: book.id, fileName: book.name, sourceUri: effectiveBook.uri };
          const startAt = withPendingJump(quickDocument, progress);
          prewarmInitialPageRef.current(effectiveBook, quickDocument, startAt);
          if (!book.coverUri) {
            // La tapa espera a que la página que se está leyendo ya esté dibujada.
            const coverBook = effectiveBook;
            setTimeout(() => {
              void renderPdfCover(book.id, coverBook.uri).then((coverUri) => {
                if (coverUri) void bookRepository.updateBookMetadata(book.id, { title: null, author: null, coverUri });
              });
            }, 2500);
          }
          if (!isMounted) return;
          setDocumentRecord(effectiveBook);
          setSavedProgress(startAt);
          setParsedDocument(quickDocument);
          setTextPrepPercent(0);
          preparePdfText(effectiveBook, quickDocument);
          return;
        }

        const parser = getParserForDocument(effectiveBook.type, effectiveBook.name);
        const parsed = await withLocalCopyFallback((uri) =>
          parser.parse(uri, (done, total) => {
            if (isMounted) setLoadingStatus(`Leyendo el libro… ${done} de ${total} páginas`);
          }),
        );
        const identified: ParsedDocument = { ...parsed, id: book.id, fileName: book.name, sourceUri: effectiveBook.uri };
        const parsedWithChapters: ParsedDocument = { ...identified, chapters: resolveChapters(book.id, identified) };
        const startAt = withPendingJump(parsedWithChapters, progress);
        if (isComic) prewarmInitialPageRef.current(effectiveBook, parsedWithChapters, startAt);
        if (isMounted) {
          setDocumentRecord(effectiveBook);
          setSavedProgress(startAt);
          setParsedDocument(parsedWithChapters);
          setIsLoading(false);
        }

        // Todo lo que no hace falta para LEER se hace después de mostrar el libro:
        // caché, capítulos, metadata y tapa.
        const persistBook = effectiveBook;
        setTimeout(() => {
          void (async () => {
            await parsedDocumentRepository.saveParsedDocument(persistBook, parsedWithChapters).catch(() => {});
            if (parsedWithChapters.chapters.length > 0) {
              await chapterRepository.saveChaptersForBook(book.id, parsedWithChapters.chapters).catch(() => {});
            }
            if (parsed.metadata) await persistBookMetadata(book.id, parsed.metadata).catch(() => {});
            if (isComic && !book.coverUri) {
              const coverUri = await renderComicCover(book.id, persistBook.uri);
              if (coverUri) await bookRepository.updateBookMetadata(book.id, { title: null, author: null, coverUri });
            }
          })();
        }, 600);
      } catch (error) {
        if (!isMounted) return;
        setParseError(getFriendlyParseErrorMessage(error));
      } finally {
        if (isGuardArmed) await runtimeStateRepository.clearReaderLoadGuard();
        if (isMounted) setIsLoading(false);
      }
    };
    void loadDocument();
    return () => { isMounted = false; };
  }, [documentId]);

  // El texto del PDF terminó de prepararse: entra el documento definitivo, parado
  // en la MISMA página que se está leyendo (los offsets del provisorio no sirven).
  useEffect(() => {
    if (!documentId) return undefined;
    const offReady = subscribePdfTextReady((bookId, ready) => {
      if (bookId !== documentId) return;
      const position = positionForPage(ready, currentPdfPageRef.current);
      setSavedProgress({
        bookId,
        chapterId: null,
        blockIndex: position.blockIndex,
        charIndex: position.charIndex,
        percentage: position.percentage,
        page: currentPdfPageRef.current,
        textLength: ready.fullText.length,
        updatedAt: new Date().toISOString(),
      });
      setParsedDocument(ready);
      setTextPrepPercent(null);
      void loadNotesRef.current();
    });
    const offProgress = subscribePdfTextProgress(({ bookId, done, total }) => {
      if (bookId === documentId && total > 0) setTextPrepPercent(Math.round((done / total) * 100));
    });
    return () => {
      offReady();
      offProgress();
    };
  }, [documentId]);

  const persistProgress = useCallback(
    async (snapshot: {
      blockIndex: number;
      charIndex: number;
      percentage: number;
      absoluteCharIndex: number;
      page: number | null;
      textLength: number;
    }) => {
      if (!documentId) return;
      // En un libro por páginas se guarda la página que se está VIENDO (si es
      // compatible con la posición): el texto solo no distingue páginas sin texto.
      const current = parsedDocumentRef.current;
      const page =
        current?.pdf && current.fullText.length === snapshot.textLength
          ? pageForProgress(snapshot.absoluteCharIndex, currentPdfPageRef.current, current.pdf.pageOffsets, current.fullText.length)
          : snapshot.page;
      await bookProgressRepository.saveProgress({
        bookId: documentId,
        chapterId: null,
        blockIndex: snapshot.blockIndex,
        charIndex: snapshot.charIndex,
        percentage: current?.pdf && page !== null ? pagePercentage(page, current.pdf.pageCount) : snapshot.percentage,
        page,
        textLength: snapshot.textLength,
      });
    },
    [documentId],
  );

  // Velocidad y voz EFECTIVAS: las propias de este libro si las ajustaste desde
  // acá; si no, las generales de Ajustes. Un ensayo se escucha a otra velocidad
  // que una novela, y reajustar en cada cambio de libro era molesto.
  const effectiveRate = documentRecord?.rate ?? settings.defaultRate;
  const effectiveVoiceId = documentRecord?.voiceId ?? settings.defaultVoiceId;

  const reader = useReaderController({
    document: parsedDocument,
    initialBlockIndex: savedProgress?.blockIndex ?? 0,
    initialCharIndex: savedProgress?.charIndex ?? 0,
    rate: effectiveRate,
    voiceId: effectiveVoiceId,
    onError: setSpeechError,
    onProgressChange: persistProgress,
  });

  // Si la voz está sonando, un error anterior ya no aplica (p. ej. faltaba la
  // voz, se instaló y el reintento anduvo): el cartel no debe quedar pegado.
  useEffect(() => {
    if (reader.isPlaying) setSpeechError(null);
  }, [reader.isPlaying]);

  useEffect(() => {
    const update = () => {
      const snapshot = documentAudioPlaybackService.getSnapshot();
      setIsAudioLoaded(Boolean(parsedDocument && snapshot.documentId === parsedDocument.id && snapshot.isLoaded));
    };
    update();
    return documentAudioPlaybackService.subscribe(update);
  }, [parsedDocument]);

  // Detiene y descarga el audio (cierra lo que se está escuchando).
  const handleStop = useCallback(async () => {
    await documentAudioPlaybackService.stopAndUnload();
  }, []);

  // Estable (prop del visor memoizado): alterna pantalla completa.
  const handleToggleImmersive = useCallback(() => {
    setIsImmersive((v) => !v);
  }, []);

  // Datos del libro por páginas (PDF o cómic), si los hay.
  const pagedInfo = parsedDocument?.pdf ?? null;
  // PDF escaneado o cómic: se lee la página, pero no hay texto que narrar.
  const canNarrate = pagedInfo ? pagedInfo.hasText : true;
  const isTextPending = Boolean(pagedInfo?.textPending);
  const isComicBook = pagedInfo?.kind === 'comic';
  // "Leer como texto": un PDF con texto se puede mostrar como texto corrido
  // (reflow). El progreso es el mismo offset en los dos modos.
  const canReflow = Boolean(pagedInfo && pagedInfo.hasText && !isComicBook);
  const showPages = Boolean(pagedInfo) && !(canReflow && settings.pdfAsText);
  // Lo que usa el resto del lector cuando se muestran PÁGINAS.
  const pageInfo = showPages ? pagedInfo : null;
  // Los mismos datos como ref: los botones de volumen se enganchan una sola vez
  // y no pueden depender de estos valores sin volver a pedirle la captura al
  // módulo nativo en cada cambio de modo.
  const showPagesRef = useRef(showPages);
  showPagesRef.current = showPages;
  const pageCountRef = useRef(0);
  pageCountRef.current = pageInfo?.pageCount ?? 0;

  // Voz lista antes de tocar play: en cuanto hay texto, se sintetiza en silencio
  // el primer tramo desde la posición actual. Al tocar play suena al instante.
  useEffect(() => {
    if (!parsedDocument || !canNarrate || isTextPending || isLoading) return;
    const timer = setTimeout(() => {
      const r = readerRef.current;
      void documentAudioPlaybackService.prewarm(parsedDocument, settings.defaultVoiceId, r.currentBlockIndex, r.currentCharIndex);
    }, 1200);
    return () => clearTimeout(timer);
    // Solo al quedar listo el texto (o al abrir): no en cada cambio de posición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedDocument, canNarrate, isTextPending, isLoading]);


  // "Escuchar" desde el Home: arranca la voz solo (una vez, al estar cargado).
  const autoListenRef = useRef(false);
  useEffect(() => {
    const wantsListen = mode === 'listen' || pendingListenRef.current;
    if (!wantsListen || autoListenRef.current || !parsedDocument || isLoading || !canNarrate) return;
    pendingListenRef.current = false;
    autoListenRef.current = true;
    void reader.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, parsedDocument, isLoading]);

  // Página inicial: donde quedó la lectura (mapeo exacto por pageOffsets).
  const initialPdfPage = useMemo(() => {
    if (!pageInfo || pageInfo.pageCount <= 0 || !parsedDocument) return 0;
    const abs = getAbsoluteCharIndex(
      parsedDocument,
      savedProgress?.blockIndex ?? 0,
      savedProgress?.charIndex ?? 0,
    );
    return pageForProgress(abs, savedProgress?.page ?? null, pageInfo.pageOffsets, parsedDocument.fullText.length);
  }, [pageInfo, savedProgress, parsedDocument]);

  // Sincrónico (no en un efecto): el primer guardado del controlador corre en SU
  // efecto, antes que los de esta pantalla, y ya tiene que ver la página correcta.
  if (appliedInitialPageRef.current !== initialPdfPage) {
    appliedInitialPageRef.current = initialPdfPage;
    currentPdfPageRef.current = initialPdfPage;
  }

  useEffect(() => {
    setPdfPageForUi(initialPdfPage);
  }, [initialPdfPage]);

  // Ref del estado de reproducción para usar en callbacks sin desestabilizarlos.
  // Cubre también el hueco entre tramos (isPreparing): en ese momento el audio
  // "sigue" aunque isPlaying sea false, y el scroll no debe pisar la posición.
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = reader.isPlaying || reader.isPreparing;
  }, [reader.isPlaying, reader.isPreparing]);

  // Ref al controlador para leerlo desde intervals/timeouts sin re-crearlos en
  // cada render (reader es un objeto nuevo por render).
  const readerRef = useRef(reader);
  readerRef.current = reader;

  // Scroll de páginas → progreso. IMPORTANTE: pasa por reader.syncPosition (el
  // controlador) y no por un write directo — al salir del lector, el controlador
  // hace un guardado final con SU posición, y si no está sincronizada pisa el
  // progreso del scroll (bug del "siempre vuelve a la página vieja").
  // Mientras SUENA el audio, la posición la manda el audio (no el scroll): así
  // el auto-seguimiento no pelea con la voz.
  const handlePdfPageChange = useCallback(
    (pageIndex: number) => {
      currentPdfPageRef.current = pageIndex;
      setPdfPageForUi(pageIndex);
      if (isPlayingRef.current) return;
      if (!parsedDocument || !pageInfo || pageInfo.pageCount <= 0) return;
      const abs = charForPage(pageIndex, pageInfo.pageOffsets, parsedDocument.fullText.length);
      const pos = getPositionFromAbsoluteChar(parsedDocument, abs);
      void readerRef.current.syncPosition(pos.blockIndex, pos.charIndex);
    },
    [parsedDocument, pageInfo],
  );

  // Modo texto (EPUB/TXT/DOCX): timestamp del ultimo scroll manual para que el
  // auto-scroll de la voz no secuestre la pantalla mientras leés por delante.
  const textScrolledAtRef = useRef(0);

  // Altos de los bloques (estimados y, al dibujarse, medidos): con esto la lista
  // sabe dónde empieza cada bloque y el arranque en el bloque guardado es exacto.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const blockLayout = useMemo(() => {
    if (!parsedDocument) return null;
    // ancho de ventana − márgenes del escenario (10+10) − padding de la lista (16+16) − padding del bloque
    const textWidth = Math.max(120, windowWidth - 20 - settings.textMargin * 2 - BLOCK_HORIZONTAL_PADDING);
    return new BlockLayoutCache(parsedDocument.blocks, {
      fontSize: settings.fontSize,
      lineHeightScale: settings.lineHeight,
      textWidth: settings.fontFamily === 'serif' ? textWidth * 0.94 : textWidth,
      verticalExtra: BLOCK_VERTICAL_PADDING + BLOCK_GAP,
    });
  }, [parsedDocument, windowWidth, settings.fontSize, settings.lineHeight, settings.fontFamily, settings.textMargin]);
  const blockLayoutRef = useRef(blockLayout);
  blockLayoutRef.current = blockLayout;
  const getBlockLayout = useCallback((_: ArrayLike<TextBlock> | null | undefined, index: number) => {
    const cache = blockLayoutRef.current;
    return cache ? cache.getItemLayout(index) : { length: 0, offset: 0, index };
  }, []);
  const handleBlockMeasured = useCallback((index: number, height: number) => {
    blockLayoutRef.current?.measure(index, height);
  }, []);
  // La tipografía cambia los altos: la lista se remonta con el cache nuevo.
  const layoutKey = `${windowWidth}-${settings.fontSize}-${settings.lineHeight}-${settings.fontFamily}-${settings.textMargin}-${settings.justifyText ? 'j' : 'l'}`;

  // Posicionar la lista de texto en un bloque. Los bloques tienen alto variable,
  // así que scrollToIndex a un bloque lejano (todavía no medido) falla, y estimar
  // el offset por alto promedio queda corto o largo. Lo determinista es REMONTAR
  // la lista anclada en el bloque destino: renderiza directamente desde ahí.
  const [textAnchor, setTextAnchor] = useState({ index: 0, nonce: 0 });
  // Bloque donde tiene que ARRANCAR la lista si se remonta. Un salto lo fija, y
  // el scroll del usuario lo va corriendo: sin esto, cambiar la letra o rotar el
  // teléfono remontaba la lista en el bloque de apertura y te devolvía atrás
  // (y peor: ese retroceso se guardaba como progreso).
  const textStartIndexRef = useRef(0);
  // Mientras la lista se reposiciona sola, lo que queda "visible" no es una
  // decisión del usuario y NO debe guardarse como progreso.
  const suppressViewSyncUntilRef = useRef(0);
  const initialTextScrollDoneRef = useRef(false);

  const anchorTextAt = useCallback((index: number) => {
    suppressViewSyncUntilRef.current = Date.now() + 1500;
    textStartIndexRef.current = Math.max(0, index);
    setTextAnchor((prev) => ({ index: Math.max(0, index), nonce: prev.nonce + 1 }));
  }, []);

  // Saltos (índice, búsqueda, anotación, abrir): anclar. Seguir a la voz: el
  // bloque siguiente ya está dibujado cerca, alcanza con un scroll animado.
  const scrollToBlock = useCallback(
    (index: number, animated = false) => {
      if (!animated) {
        anchorTextAt(index);
        return;
      }
      suppressViewSyncUntilRef.current = Date.now() + 1500;
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.18 });
    },
    [anchorTextAt],
  );

  // RN avisa "no pude ir al índice" cuando la celda todavía no se midió. Si el
  // índice es el ancla actual, la lista YA está montada en ese bloque (lo de
  // arriba es un espaciador): remontar de nuevo la dejaba sin medir y volvía a
  // fallar → bucle infinito de re-renders (150 % de CPU, y el scroll no
  // respondía). Se reintenta una vez cuando las celdas ya midieron.
  const handleTextScrollFailed = useCallback(
    (info: { index: number }) => {
      if (info.index === textStartIndexRef.current) {
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }), 160);
        return;
      }
      anchorTextAt(info.index);
    },
    [anchorTextAt],
  );

  // Scroll manual en la lista de texto → guarda progreso (el bloque de arriba).
  // Identidad estable (RN prohíbe cambiar onViewableItemsChanged en caliente):
  // lee el controlador por ref, deps vacías.
  /**
   * ¿Se ve el final del libro?
   *
   * El progreso se toma del párrafo de ARRIBA de la pantalla. Al llegar al final
   * del libro, el último párrafo nunca llega arriba: en un libro corto el avance
   * se quedaba en 67 % con el libro terminado, nunca se marcaba como leído y no
   * se ofrecía el siguiente de la saga.
   *
   * La señal es que el ÚLTIMO párrafo esté en pantalla, no el tamaño de la
   * lista: con alturas estimadas, el alto total que informa la lista no es el
   * real hasta que se dibuja todo, y si el libro abre ya en la última pantalla
   * deslizar no la mueve y no llega ningún evento de scroll.
   */
  const textAtEndRef = useRef(false);

  const syncToTextEnd = useCallback(() => {
    const blocks = parsedDocumentRef.current?.blocks;
    if (!blocks || blocks.length === 0) return;
    const last = blocks.length - 1;
    textStartIndexRef.current = last;
    void readerRef.current.syncPosition(last, blocks[last].endChar - blocks[last].startChar);
  }, []);

  const handleTextViewable = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (isPlayingRef.current) return; // sonando manda el audio, no el scroll
      // Al abrir, la lista arranca arriba de todo: si eso se guardara, cada
      // reapertura pisaría el progreso con 0%. Recién cuenta el scroll del usuario.
      if (!initialTextScrollDoneRef.current || Date.now() < suppressViewSyncUntilRef.current) return;
      const total = parsedDocumentRef.current?.blocks.length ?? 0;
      const seVeElFinal = total > 1 && viewableItems.some((v) => v.index === total - 1);
      textAtEndRef.current = seVeElFinal;
      // Con el final en pantalla manda el final del libro, no el párrafo de arriba.
      if (seVeElFinal) { syncToTextEnd(); return; }
      const topIndex = viewableItems.find((v) => v.index !== null)?.index;
      if (typeof topIndex === 'number') {
        textStartIndexRef.current = topIndex;
        void readerRef.current.syncPosition(topIndex, 0);
      }
    },
    [syncToTextEnd],
  );
  const textViewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;

  const currentAbsoluteChar = useMemo(() => {
    if (!parsedDocument) return 0;
    const block = parsedDocument.blocks[reader.currentBlockIndex];
    return block ? block.startChar + reader.currentCharIndex : 0;
  }, [parsedDocument, reader.currentBlockIndex, reader.currentCharIndex]);

  const currentChapter = useMemo(() => {
    const chapters = parsedDocument?.chapters;
    if (!chapters?.length) return null;
    const found = chapters.find((ch) => ch.startChar <= currentAbsoluteChar && currentAbsoluteChar < ch.endChar);
    if (found) return found;
    // Fuera de todo capítulo: antes del primero (portadilla, prólogo sin indexar)
    // es el primero; pasado el último, el último.
    return currentAbsoluteChar < chapters[0].startChar ? chapters[0] : chapters[chapters.length - 1];
  }, [parsedDocument, currentAbsoluteChar]);

  // Modo texto: al abrir (o al pasar de páginas a texto), ir a donde quedó la lectura.
  useEffect(() => {
    if (!parsedDocument || showPages) return;
    initialTextScrollDoneRef.current = false;
    const index = Math.min(Math.max(savedProgress?.blockIndex ?? 0, 0), parsedDocument.blocks.length - 1);
    const startTimer = index > 0 ? setTimeout(() => scrollToBlock(index), 80) : null;
    // Se habilita el guardado por scroll cuando el salto inicial ya se asentó.
    const doneTimer = setTimeout(() => { initialTextScrollDoneRef.current = true; }, index > 0 ? 2200 : 600);
    return () => {
      if (startTimer) clearTimeout(startTimer);
      clearTimeout(doneTimer);
    };
  }, [parsedDocument, savedProgress, scrollToBlock, showPages]);

  // Auto-scroll: la vista baja sola a la velocidad elegida.
  //
  // Se mueve de a poco y seguido (cada 100 ms) en vez de a saltos grandes, para
  // que se vea como un desplazamiento y no como tirones. Se apaga solo mientras
  // suena la voz —ahí manda el audio— y en pantalla de páginas usa el handle de
  // la lista de páginas.
  const autoScrollRef = useRef<{ list: FlatList<TextBlock> | null; offset: number }>({ list: null, offset: 0 });
  useEffect(() => {
    const speed = settings.autoScrollSpeed;
    if (speed <= 0 || isLoading) return;
    const TICK_MS = 100;
    const step = (speed * TICK_MS) / 1000;
    const timer = setInterval(() => {
      if (isPlayingRef.current) return; // la voz ya mueve la lectura
      if (showPages) {
        pdfListRef.current?.scrollBy(step);
        return;
      }
      const next = autoScrollRef.current.offset + step;
      autoScrollRef.current.offset = next;
      listRef.current?.scrollToOffset({ offset: next, animated: false });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [settings.autoScrollSpeed, isLoading, showPages]);

  // ── Pasar de página con los botones de volumen ───────────────────────────
  //
  // Se prende sólo con el libro abierto y sólo si el ajuste está puesto: fuera
  // del lector los botones tienen que seguir siendo el volumen. El módulo
  // nativo se los saca a Android antes de que llegue el panel de volumen.
  //
  // Arriba = página anterior, abajo = siguiente. Es el orden de ReadEra y el que
  // coincide con el gesto: bajar el dedo avanza, como bajar por la hoja.
  useEffect(() => {
    if (!settings.volumeKeysTurnPage || isLoading) return;
    setCaptureVolumeKeys(true);
    const quitar = addVolumeKeyListener((key) => {
      const haciaAdelante = key === 'down';
      if (showPagesRef.current) {
        const total = pageCountRef.current;
        if (total <= 0) return;
        const destino = Math.min(Math.max(currentPdfPageRef.current + (haciaAdelante ? 1 : -1), 0), total - 1);
        if (destino === currentPdfPageRef.current) return;
        pdfListRef.current?.scrollToPage(destino);
        return;
      }
      // En texto corrido no hay páginas: se corre una pantalla, dejando un
      // par de renglones de solape para no perder el hilo.
      const salto = Math.max(windowHeight - 160, 200);
      const destino = Math.max(autoScrollRef.current.offset + (haciaAdelante ? salto : -salto), 0);
      autoScrollRef.current.offset = destino;
      textScrolledAtRef.current = Date.now();
      listRef.current?.scrollToOffset({ offset: destino, animated: true });
    });
    return () => {
      quitar();
      setCaptureVolumeKeys(false);
    };
  }, [settings.volumeKeysTurnPage, isLoading, windowHeight]);

  // Un cambio de tipografía (o rotar) remonta la lista: mientras se acomoda, lo
  // que queda visible no es una decisión del usuario y no debe guardarse.
  useEffect(() => {
    suppressViewSyncUntilRef.current = Date.now() + 1200;
  }, [layoutKey]);

  // Cambiar de modo (páginas ↔ texto) conserva la posición: la vista nueva arranca
  // donde está el controlador, no donde estaba al abrir el libro.
  const handleToggleReflow = useCallback(() => {
    const r = readerRef.current;
    if (parsedDocument) {
      setSavedProgress((previous) => ({
        bookId: parsedDocument.id,
        chapterId: null,
        blockIndex: r.currentBlockIndex,
        charIndex: r.currentCharIndex,
        percentage: r.progressPercentage,
        page: previous?.page ?? null,
        textLength: parsedDocument.fullText.length,
        updatedAt: new Date().toISOString(),
      }));
    }
    setActiveSheet('none');
    void updateSettings({ pdfAsText: !settings.pdfAsText });
  }, [parsedDocument, settings.pdfAsText, updateSettings]);

  const loadNotes = useCallback(async () => {
    if (!documentId) return;
    setNotes(await noteRepository.listForBook(documentId));
  }, [documentId]);

  loadNotesRef.current = loadNotes;

  const showFlash = useCallback((message: string) => {
    setFlashMessage(message);
    setTimeout(() => setFlashMessage((current) => (current === message ? null : current)), 1600);
  }, []);

  // Salta a una posición del libro (índice, resultado de búsqueda, anotación).
  const jumpToChar = useCallback(
    (absoluteChar: number) => {
      if (!parsedDocument) return;
      const pos = getPositionFromAbsoluteChar(parsedDocument, absoluteChar);
      const r = readerRef.current;
      void r.seekToBlock(pos.blockIndex, r.isPlaying);
      if (pageInfo) {
        pdfListRef.current?.scrollToPage(pageForChar(absoluteChar, pageInfo.pageOffsets));
      } else {
        textScrolledAtRef.current = 0;
        scrollToBlock(pos.blockIndex);
      }
    },
    [parsedDocument, pageInfo, scrollToBlock],
  );

  // Al volver de "Sobre este libro": refresca anotaciones y aplica el salto pedido.
  useFocusEffect(
    useCallback(() => {
      void loadNotes();
      if (!parsedDocument) return;
      const request = readerJumpStore.consumeRequest(parsedDocument.id);
      if (!request) return;
      if (request.charIndex !== null) jumpToChar(request.charIndex);
      // "Escuchar" desde "Sobre este libro" con el lector ya abierto: se vuelve
      // acá y se arranca la voz, en vez de abrir un segundo lector.
      if (request.listen) void readerRef.current.play();
    }, [loadNotes, parsedDocument, jumpToChar]),
  );

  // ¿Hay un marcador donde estoy? En PDF se compara por página; en texto, por párrafo.
  const bookmarkHere = useMemo(() => {
    if (!parsedDocument) return null;
    if (pageInfo) {
      return notes.find((n) => n.type === 'bookmark' && n.page === pdfPageForUi) ?? null;
    }
    const block = parsedDocument.blocks[reader.currentBlockIndex];
    if (!block) return null;
    return notes.find((n) => n.type === 'bookmark' && n.charIndex >= block.startChar && n.charIndex < block.endChar) ?? null;
  }, [notes, parsedDocument, pageInfo, pdfPageForUi, reader.currentBlockIndex]);

  // Posición + extracto de lo que se está viendo ahora (para marcadores).
  const getCurrentTarget = useCallback((): AnnotationTarget | null => {
    if (!parsedDocument) return null;
    if (pageInfo) {
      const page = currentPdfPageRef.current;
      const charIndex = charForPage(page, pageInfo.pageOffsets, parsedDocument.fullText.length);
      return { charIndex, page, excerpt: parsedDocument.fullText.slice(charIndex, charIndex + 160).trim() };
    }
    const block = parsedDocument.blocks[readerRef.current.currentBlockIndex];
    if (!block) return null;
    return { charIndex: block.startChar, page: null, excerpt: block.text.slice(0, 160).trim() };
  }, [parsedDocument, pageInfo]);

  /**
   * Guarda como cita la ORACIÓN que la voz está diciendo.
   *
   * Escuchando no se puede buscar el párrafo en pantalla: para cuando lo
   * encontrás, la voz ya siguió. Esto lo agarra de la posición del audio.
   */
  const handleMarkSpoken = useCallback(async () => {
    if (!documentId || !parsedDocument) return;
    const span = sentenceSpanAround(parsedDocument.fullText, currentAbsoluteChar);
    const cita = parsedDocument.fullText.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
    if (cita.length === 0) return;
    await noteRepository.addNote({
      bookId: documentId,
      type: 'quote',
      charIndex: span.start,
      page: pageInfo ? currentPdfPageRef.current : null,
      body: cita.slice(0, MAX_QUOTE_CHARS),
      comment: null,
    });
    await loadNotes();
    showFlash('Cita guardada');
  }, [documentId, parsedDocument, currentAbsoluteChar, pageInfo, loadNotes, showFlash]);

  const handleToggleBookmark = useCallback(async () => {
    if (!documentId) return;
    if (bookmarkHere) {
      await noteRepository.removeNote(bookmarkHere.id);
      showFlash('Marcador quitado');
    } else {
      const target = getCurrentTarget();
      if (!target) return;
      await noteRepository.addNote({
        bookId: documentId,
        type: 'bookmark',
        charIndex: target.charIndex,
        page: target.page,
        body: target.excerpt || null,
        comment: null,
      });
      showFlash('Marcador guardado');
    }
    await loadNotes();
  }, [documentId, bookmarkHere, getCurrentTarget, loadNotes, showFlash]);

  const handleLongPressBlock = useCallback((block: TextBlock) => {
    setNoteDraft('');
    setAnnotationTarget({ charIndex: block.startChar, page: null, excerpt: block.text.slice(0, MAX_QUOTE_CHARS).trim() });
  }, []);

  // Mantener apretado sobre una página: se cita LO QUE HAY BAJO EL DEDO.
  //
  // Sobre una imagen no se puede arrastrar para seleccionar como en el modo
  // texto, así que el punto lo resuelve Pdfium: devuelve la oración entera que
  // está ahí. Si el PDF no tiene texto (un escaneo sin OCR) o el dedo cayó en un
  // blanco, queda la nota de la página, que es lo que se hacía antes.
  const handleLongPressPage = useCallback(
    (pageIndex: number, x: number, y: number) => {
      if (!parsedDocument?.pdf) return;
      const pageOffsets = parsedDocument.pdf.pageOffsets;
      const total = parsedDocument.fullText.length;
      const start = charForPage(pageIndex, pageOffsets, total);
      const nextStart = pageIndex + 1 < pageOffsets.length ? pageOffsets[pageIndex + 1] : total;
      const porPagina = () => {
        setNoteDraft('');
        setAnnotationTarget({
          charIndex: start,
          page: pageIndex,
          excerpt: parsedDocument.fullText.slice(start, Math.min(nextStart, start + MAX_QUOTE_CHARS)).trim(),
        });
      };

      const uri = documentRecordRef.current?.uri;
      if (!uri || !parsedDocument.pdf.hasText) {
        porPagina();
        return;
      }
      void getTextAtPoint(uri, pageIndex, x, y).then((hit) => {
        const cita = hit?.text.trim();
        if (!cita) {
          porPagina();
          return;
        }
        // La cita viene del PDF crudo; el índice tiene que ser del texto del libro.
        const at = findQuoteIndex(parsedDocument.fullText, cita, start, nextStart);
        setNoteDraft('');
        setAnnotationTarget({
          charIndex: at ?? start,
          page: pageIndex,
          excerpt: cita.slice(0, MAX_QUOTE_CHARS),
        });
      });
    },
    [parsedDocument],
  );

  const handleSaveAnnotation = useCallback(
    async (type: NoteType) => {
      if (!documentId || !annotationTarget) return;
      const comment = noteDraft.trim();
      if (type === 'note' && !comment) return;
      await noteRepository.addNote({
        bookId: documentId,
        type,
        charIndex: annotationTarget.charIndex,
        page: annotationTarget.page,
        body: annotationTarget.excerpt || null,
        comment: comment || null,
      });
      setAnnotationTarget(null);
      setNoteDraft('');
      showFlash(type === 'quote' ? 'Cita guardada' : type === 'note' ? 'Nota guardada' : 'Marcador guardado');
      await loadNotes();
    },
    [documentId, annotationTarget, noteDraft, loadNotes, showFlash],
  );

  const handleRunSearch = useCallback(() => {
    if (!parsedDocument) return;
    // Plegar el libro entero (sin tildes/mayúsculas) cuesta: se hace una vez por libro.
    if (foldedTextRef.current?.docId !== parsedDocument.id) {
      foldedTextRef.current = { docId: parsedDocument.id, folded: foldText(parsedDocument.fullText) };
    }
    setSearchResults(searchText(parsedDocument.fullText, searchQuery, 200, foldedTextRef.current.folded));
  }, [parsedDocument, searchQuery]);

  const handleDimChange = useCallback(
    async (delta: number) => {
      const next = Math.min(MAX_DIM, Math.max(0, Math.round((settings.screenDim + delta) * 10) / 10));
      await updateSettings({ screenDim: next });
    },
    [settings.screenDim, updateSettings],
  );

  // Página por donde va la VOZ (para marcarla y seguirla mientras suena).
  // Adelanto (~4 s de habla): la posición interpolada del audio corre unos
  // segundos DETRÁS de la voz real (pausas + silencios del WAV), así que sin
  // esto la hoja pasaba tarde. Con el adelanto, pasa apenas la voz llega.
  const AUDIO_PAGE_LOOKAHEAD_CHARS = 80;

  const audioPage = useMemo(() => {
    if (!pageInfo || pageInfo.pageCount <= 0) return null;
    if (!parsedDocument || parsedDocument.fullText.length === 0) return null;
    const biased = Math.min(parsedDocument.fullText.length, currentAbsoluteChar + AUDIO_PAGE_LOOKAHEAD_CHARS);
    return pageForChar(biased, pageInfo.pageOffsets);
  }, [pageInfo, parsedDocument, currentAbsoluteChar]);


  // ── "Dónde quedaste" ──────────────────────────────────────────────────────
  //
  // Volver a un libro después de dos semanas es volver a mitad de una escena
  // que ya no te acordás. Esto muestra, una sola vez al abrir, el párrafo donde
  // cortaste y lo último que habías anotado.
  //
  // Se mira cuándo se guardó el PROGRESO (no cuándo abriste el libro): es la
  // fecha en que realmente dejaste de leer.
  useEffect(() => {
    if (resumeShownRef.current) return;
    if (!parsedDocument || !savedProgress || isLoading) return;
    // Un PDF abre con un documento PROVISORIO ("Página 1", "Página 2"…) y el
    // texto de verdad llega después. Citar eso mostraría "Página 1" en vez del
    // párrafo. No se marca como mostrado: se reintenta cuando llega el texto.
    if (parsedDocument.pdf?.textPending) return;
    if (!leftOffAtRef.current) return;
    const dejadoEl = Date.parse(leftOffAtRef.current);
    if (!Number.isFinite(dejadoEl)) return;
    if (Date.now() - dejadoEl < RESUME_HINT_AFTER_MS) return;
    if ((savedProgress.percentage ?? 0) <= 0) return;

    resumeShownRef.current = true;
    const at = getAbsoluteCharIndex(parsedDocument, savedProgress.blockIndex, savedProgress.charIndex);
    const span = sentenceSpanAround(parsedDocument.fullText, at);
    const excerpt = parsedDocument.fullText.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
    if (excerpt.length === 0) return;
    // Las notas más cercanas a donde cortaste, que es lo que estabas pensando.
    const cercanas = [...notesRef.current]
      .sort((a, b) => Math.abs(a.charIndex - at) - Math.abs(b.charIndex - at))
      .slice(0, 3);
    setResumeHint({ excerpt, notes: cercanas });
  }, [parsedDocument, savedProgress, isLoading]);

  // ── Seguir con el siguiente de la saga ───────────────────────────────────
  //
  // Al llegar al final, se ofrece el libro que sigue en la MISMA carpeta. Una
  // saga se lee como una sola cosa: terminar el tomo 2 y tener que volver a la
  // biblioteca a buscar el 3 corta justo cuando más ganas hay de seguir.
  const [nextBook, setNextBook] = useState<Book | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const isAtEnd = pageInfo
    ? pageInfo.pageCount > 1 && pdfPageForUi >= pageInfo.pageCount - 1
    : (parsedDocument?.blocks.length ?? 0) > 1 && reader.progressPercentage >= 99;

  useEffect(() => {
    if (!isAtEnd || nextDismissed || nextBook || !documentRecord) return;
    let vivo = true;
    // Se consulta recién al llegar al final: no tiene sentido traer la
    // biblioteca entera en cada apertura para algo que casi nunca se usa.
    void bookRepository.listAllBooks().then((books) => {
      if (!vivo) return;
      setNextBook(nextInSeries(documentRecord, books));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [isAtEnd, nextDismissed, nextBook, documentRecord]);

  const openNextBook = useCallback(() => {
    if (!nextBook) return;
    const destino = nextBook.id;
    setNextBook(null);
    router.replace({ pathname: '/reader', params: { documentId: destino } });
  }, [nextBook]);

  // ── Resaltar en la PÁGINA lo que la voz está leyendo ──────────────────────
  //
  // En modo texto la palabra se resalta sola (el bloque sabe su rango). Sobre
  // una página dibujada no hay texto que resaltar: hay una imagen. Así que se
  // le piden a Pdfium las COORDENADAS de esa palabra dentro de la página y se
  // pinta un rectángulo encima. Funciona igual en un PDF con texto que en uno
  // escaneado con OCR, porque las coordenadas salen del propio PDF.
  const [speakingRects, setSpeakingRects] = useState<PageTextRect[] | null>(null);
  const speakingKeyRef = useRef('');
  // La posición al día, por ref: si entrara como dependencia, el efecto se
  // recrearía cuatro veces por segundo sin necesidad.
  const absoluteCharRef = useRef(0);
  absoluteCharRef.current = currentAbsoluteChar;

  useEffect(() => {
    // Solo mientras suena la voz Y se están viendo páginas.
    if (!reader.isPlaying || !showPages || audioPage === null || !pageInfo || !documentRecord) {
      if (speakingKeyRef.current !== '') {
        speakingKeyRef.current = '';
        setSpeakingRects(null);
      }
      return;
    }
    const block = parsedDocument?.blocks[reader.currentBlockIndex];
    const range = reader.currentWordRange;
    const word = block && range ? block.text.slice(range.start, range.end).trim() : '';
    if (word.length < 2) return;

    // La misma palabra en la misma página no se vuelve a pedir.
    const key = `${audioPage}:${word}:${block?.startChar ?? 0}+${range?.start ?? 0}`;
    if (key === speakingKeyRef.current) return;
    speakingKeyRef.current = key;

    // Pista de por dónde cae dentro de la página (0 a 1): el texto del libro
    // está unido y limpiado, así que la posición exacta no corresponde con el
    // índice crudo de la página, pero la proporción sí alcanza para elegir la
    // aparición correcta cuando la palabra se repite.
    const pageStart = pageInfo.pageOffsets[audioPage] ?? 0;
    const pageEnd = pageInfo.pageOffsets[audioPage + 1] ?? parsedDocument?.fullText.length ?? pageStart + 1;
    const span = Math.max(pageEnd - pageStart, 1);
    const hint = Math.min(Math.max((absoluteCharRef.current - pageStart) / span, 0), 1);

    // SIN bandera de cancelado a propósito: este efecto se vuelve a correr en
    // cada aviso de la voz (cuatro por segundo), y una limpieza que cancelara
    // el pedido en vuelo lo mataba SIEMPRE antes de que llegara la respuesta —
    // el resaltado no aparecía nunca. La comparación con `speakingKeyRef`
    // alcanza: solo se aplica la respuesta de la última palabra pedida.
    void getPageTextRects(documentRecord.uri, audioPage, word, hint).then((rects) => {
      if (speakingKeyRef.current === key) setSpeakingRects(rects.length > 0 ? rects : null);
    });
  }, [
    reader.isPlaying,
    reader.currentBlockIndex,
    reader.currentWordRange,
    showPages,
    audioPage,
    pageInfo,
    documentRecord,
    parsedDocument,
  ]);

  // Auto-seguimiento: si estabas en la página que la voz leía, pasa de página
  // con ella. Si te fuiste a mirar otra parte, no te molesta.
  const prevAudioPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (audioPage === null || !reader.isPlaying) {
      prevAudioPageRef.current = audioPage;
      return;
    }
    const prev = prevAudioPageRef.current;
    prevAudioPageRef.current = audioPage;
    if (prev === null || prev === audioPage) return;
    if (currentPdfPageRef.current === prev) {
      pdfListRef.current?.scrollToPage(audioPage);
    }
  }, [audioPage, reader.isPlaying]);

  useEffect(() => {
    if (!parsedDocument || parsedDocument.blocks.length === 0) return;
    // Seguir a la voz SOLO si esta sonando y el usuario no scrolleo hace poco.
    // Antes secuestraba la pantalla en cada bloque aunque estuvieras leyendo
    // por delante de la narracion.
    if (!reader.isPlaying) return;
    if (Date.now() - textScrolledAtRef.current < 4000) return;
    const timer = setTimeout(() => scrollToBlock(reader.currentBlockIndex, true), 80);
    return () => clearTimeout(timer);
  }, [parsedDocument, reader.currentBlockIndex, reader.isPlaying, scrollToBlock]);

  useEffect(() => {
    const shouldKeepAwake = settings.keepScreenAwakeWhileReading && reader.isPlaying;
    // Sólo activamos con la app en primer plano: si no, el módulo nativo rechaza
    // con "current activity no longer available" y ensucia la consola. El audio
    // sigue igual en background (expo-audio), así que no se pierde nada.
    if (shouldKeepAwake && AppState.currentState === 'active') {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
    return () => { void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, [reader.isPlaying, settings.keepScreenAwakeWhileReading]);

  // El interval SOLO depende de sleepDeadlineAt. Antes las deps incluían el
  // objeto `reader` (nuevo en cada render), asi que durante la reproduccion se
  // recreaba varias veces por segundo y nunca cumplia el segundo → el
  // temporizador de sueño no paraba la voz jamas. Ahora lee reader por ref.
  useEffect(() => {
    if (!sleepDeadlineAt) return;
    setClockNow(Date.now());
    const interval = setInterval(() => {
      const nextNow = Date.now();
      setClockNow(nextNow);
      if (nextNow >= sleepDeadlineAt) {
        setSleepDeadlineAt(null);
        setSleepTimerMinutes(null);
        const r = readerRef.current;
        // También si está preparando el tramo siguiente: en ese hueco isPlaying
        // es false y el temporizador no paraba nada (y ya no volvía a cumplirse).
        if (r.isPlaying || r.isPreparing) void r.stop();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepDeadlineAt]);

  // Frenar al llegar al final del capítulo marcado. Va aparte del temporizador
  // de minutos porque no depende del reloj sino de la posición de la voz.
  useEffect(() => {
    if (stopAtChar === null) return;
    if (currentAbsoluteChar < stopAtChar) return;
    setStopAtChar(null);
    const r = readerRef.current;
    if (r.isPlaying || r.isPreparing) void r.stop();
  }, [stopAtChar, currentAbsoluteChar]);

  const findBlockForChar = useCallback(
    (targetChar: number) => {
      if (!parsedDocument?.blocks?.length) return 0;
      const blocks = parsedDocument.blocks;
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].startChar <= targetChar) return i;
      }
      return 0;
    },
    [parsedDocument],
  );

  /**
   * Anuncia el capítulo ANTES de que arranque el audio, si corresponde.
   *
   * Nunca interrumpe algo que ya está sonando: por eso se llama siempre justo
   * antes de un `play` o de un salto, y nunca desde el bucle de la voz.
   */
  const announceChapterBefore = useCallback(async (atChar: number, forced: boolean) => {
    if (!settings.announceChapters || !parsedDocument) return;
    const chapter = chapterToAnnounce(parsedDocument.chapters, atChar, forced);
    if (!chapter) return;
    await speakAnnouncement(chapter, effectiveVoiceId, detectLanguage(parsedDocument.fullText), effectiveRate);
  }, [settings.announceChapters, parsedDocument, effectiveVoiceId, effectiveRate]);

  // Saltar de capítulo: si estabas escuchando, primero se anuncia a dónde fuiste.
  const jumpToChapter = useCallback(
    async (startChar: number) => {
      const sonando = readerRef.current.isPlaying;
      if (sonando) {
        await readerRef.current.stop();
        await announceChapterBefore(startChar, true);
      }
      await readerRef.current.seekToBlock(findBlockForChar(startChar), sonando);
    },
    [findBlockForChar, announceChapterBefore],
  );

  const handleNextChapter = useCallback(() => {
    if (!parsedDocument?.chapters?.length || !currentChapter) return;
    const next = parsedDocument.chapters.find((ch) => ch.orderIndex === currentChapter.orderIndex + 1);
    if (!next) return;
    void jumpToChapter(next.startChar);
  }, [parsedDocument, currentChapter, jumpToChapter]);

  const handlePreviousChapter = useCallback(() => {
    if (!parsedDocument?.chapters?.length || !currentChapter) return;
    const prev = parsedDocument.chapters.find((ch) => ch.orderIndex === currentChapter.orderIndex - 1);
    if (!prev) return;
    void jumpToChapter(prev.startChar);
  }, [parsedDocument, currentChapter, jumpToChapter]);

  const sleepTimerOptions = useMemo(() => [
    { value: 'off', label: 'Sin temporizador', description: 'La lectura sigue hasta que la detengas.' },
    ...(currentChapter
      ? [{
          value: 'chapter',
          label: 'Al terminar el capítulo',
          description: `Se detiene al final de "${currentChapter.title}", así retomás en un corte natural.`,
        }]
      : []),
    { value: '10', label: '10 minutos', description: 'Se detiene sola después de diez minutos.' },
    { value: '20', label: '20 minutos', description: 'Se detiene sola después de veinte minutos.' },
    { value: '30', label: '30 minutos', description: 'Se detiene sola después de treinta minutos.' },
  ], [currentChapter]);

  const sleepTimerLabel = useMemo(() => formatRemainingTime(sleepDeadlineAt, clockNow), [clockNow, sleepDeadlineAt]);

  const readerStatus = useMemo(() => {
    if (parseError) return { label: parseError.includes('no contiene texto') ? 'PDF sin texto' : 'Error', tone: 'danger' as StatusTone };
    if (speechError) return { label: 'Error de voz', tone: 'danger' as StatusTone };
    if (reader.isPreparing) return { label: 'Preparando audio', tone: 'primary' as StatusTone };
    if (reader.isPlaying) return { label: 'Reproduciendo', tone: 'primary' as StatusTone };
    return { label: 'Detenido', tone: 'neutral' as StatusTone };
  }, [parseError, reader.isPlaying, reader.isPreparing, speechError]);

  const statusColors = getStatusColors(colors, readerStatus.tone);

  /**
   * Cambiar la velocidad desde el lector la guarda en ESTE libro, no en el
   * ajuste general: es el lugar donde uno dice "este texto lo quiero más
   * lento", no "todos los libros".
   */
  const handleRateChange = useCallback(
    async (direction: 1 | -1) => {
      const nextRate = direction > 0 ? increaseRate(effectiveRate) : decreaseRate(effectiveRate);
      if (!documentId) return;
      setDocumentRecord((prev) => (prev ? { ...prev, rate: nextRate } : prev));
      await bookRepository.setPlaybackPrefs(documentId, { rate: nextRate });
    },
    [effectiveRate, documentId],
  );

  /** Vuelve a la velocidad general de Ajustes para este libro. */
  const handleResetRate = useCallback(async () => {
    if (!documentId) return;
    setDocumentRecord((prev) => (prev ? { ...prev, rate: null } : prev));
    await bookRepository.setPlaybackPrefs(documentId, { rate: null });
  }, [documentId]);

  const handleSleepTimerChange = useCallback((optionValue: string) => {
    setIsSleepTimerPickerVisible(false);
    // Los dos modos se excluyen: elegir uno apaga el otro.
    if (optionValue === 'chapter') {
      setSleepTimerMinutes(null);
      setSleepDeadlineAt(null);
      setStopAtChar(currentChapter ? currentChapter.endChar : null);
      return;
    }
    setStopAtChar(null);
    if (optionValue === 'off') { setSleepTimerMinutes(null); setSleepDeadlineAt(null); return; }
    const minutes = Number(optionValue);
    if (!Number.isFinite(minutes) || minutes <= 0) { setSleepTimerMinutes(null); setSleepDeadlineAt(null); return; }
    setSleepTimerMinutes(minutes);
    setSleepDeadlineAt(Date.now() + minutes * 60 * 1000);
  }, [currentChapter]);

  const handleTogglePlayback = useCallback(async () => {
    if (reader.isPreparing) return;
    if (reader.isPlaying) { await reader.stop(); return; }
    await announceChapterBefore(absoluteCharRef.current, false);
    await reader.play();
  }, [reader, announceChapterBefore]);

  // Estable entre renders (lee el controlador por ref): con un closure nuevo por
  // párrafo, cada tick de la voz re-renderizaba todos los párrafos montados.
  const handlePressBlock = useCallback((block: TextBlock) => {
    void readerRef.current.seekToBlock(block.index, readerRef.current.isPlaying);
  }, []);

  // Cleanup SOLO al desmontar. `reader` es un objeto nuevo en cada render,
  // así que usarlo como dependencia ejecutaría shutdown() en cada render.
  const shutdownRef = useRef(reader.shutdown);
  useEffect(() => {
    shutdownRef.current = reader.shutdown;
  }, [reader.shutdown]);

  useEffect(() => {
    return () => {
      void shutdownRef.current();
      void closePdf();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: documentRecord ? getDisplayTitle(documentRecord) : 'Lector' }} />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.text }]}>{loadingStatus}</Text>
      </SafeAreaView>
    );
  }

  if (parseError || !parsedDocument || !documentRecord) {
    return (
      <SafeAreaView style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: documentRecord ? getDisplayTitle(documentRecord) : 'Lector' }} />
        <View style={[styles.errorCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statusBadge, { backgroundColor: statusColors.backgroundColor, borderColor: statusColors.borderColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusColors.textColor }]}>{readerStatus.label}</Text>
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>No se pudo abrir el libro</Text>
          <Text style={[styles.errorMessage, { color: colors.textMuted }]}>{parseError ?? 'El libro elegido no está disponible.'}</Text>
          <AppButton label="Volver al inicio" onPress={() => router.replace('/')} colors={colors} />
        </View>
      </SafeAreaView>
    );
  }

  const hasChapters = Boolean(parsedDocument.chapters?.length);
  const hasPreviousChapter = hasChapters && Boolean(currentChapter && currentChapter.orderIndex > 0);
  const hasNextChapter = hasChapters && Boolean(currentChapter && currentChapter.orderIndex < (parsedDocument.chapters?.length ?? 0) - 1);

  return (
    // Arriba ya está la cabecera del navegador: sumarle el inset del sistema dejaba
    // una franja vacía de ~60 px entre el título y la página.
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar hidden={isImmersive} />
      <Stack.Screen
        options={{
          title: documentRecord ? getDisplayTitle(documentRecord) : 'Lector',
          headerShown: !isImmersive,
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton
                name={bookmarkHere ? 'bookmark' : 'bookmark-outline'}
                label={bookmarkHere ? 'Quitar marcador' : 'Agregar marcador'}
                onPress={() => { void handleToggleBookmark(); }}
                colors={colors}
                active={Boolean(bookmarkHere)}
              />
              <IconButton
                name="information-circle-outline"
                label="Sobre este libro"
                onPress={() => router.push({ pathname: '/book', params: { bookId: documentRecord.id, from: 'reader' } })}
                colors={colors}
              />
            </View>
          ),
        }}
      />

      <View
        style={[
          styles.readerStage,
          { backgroundColor: readerColors.readerSurface, borderColor: colors.border },
          isImmersive ? styles.readerStageImmersive : null,
        ]}
      >
        {pageInfo ? (
          <PdfPageList
            ref={pdfListRef}
            bookId={documentRecord.id}
            kind={pageInfo.kind ?? 'pdf'}
            sourceUri={documentRecord.uri}
            pageCount={pageInfo.pageCount}
            pageAspect={pageInfo.pageAspect}
            crop={settings.cropPdfMargins ? pageInfo.crop : null}
            colorMode={readingMode}
            initialPage={initialPdfPage}
            colors={readerColors}
            onPageChange={handlePdfPageChange}
            onTap={handleToggleImmersive}
            tapEdgesTurnPage={settings.tapEdgesTurnPage}
            horizontal={settings.horizontalPages}
            onLongPressPage={handleLongPressPage}
            speakingPage={reader.isPlaying ? audioPage : null}
            speakingRects={speakingRects}
          />
        ) : (
        <FlatList
          // La clave cambia en cada anclaje: la lista se remonta en ese bloque.
          key={`text-${textAnchor.nonce}-${layoutKey}`}
          initialScrollIndex={Math.min(textStartIndexRef.current, parsedDocument.blocks.length - 1)}
          getItemLayout={getBlockLayout}
          style={styles.readerList}
          ref={listRef}
          data={parsedDocument.blocks}
          keyExtractor={(item) => item.index.toString()}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: settings.textMargin }]}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => { textScrolledAtRef.current = Date.now(); }}
          onScroll={(event) => { autoScrollRef.current.offset = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={100}
          onViewableItemsChanged={handleTextViewable}
          viewabilityConfig={textViewabilityConfig}
          onScrollToIndexFailed={handleTextScrollFailed}
          renderItem={({ item }) => (
            <ReaderBlockCard
              block={item}
              isActive={item.index === reader.currentBlockIndex}
              colors={readerColors}
              fontSize={settings.fontSize}
              fontFamily={settings.fontFamily}
              lineHeightScale={settings.lineHeight}
              justify={settings.justifyText}
              wordRange={item.index === reader.currentBlockIndex ? reader.currentWordRange : null}
              onPressBlock={handlePressBlock}
              onLongPressBlock={handleLongPressBlock}
              onMeasured={handleBlockMeasured}
            />
          )}
        />
        )}
        {pageInfo && pageInfo.pageCount > 0 && !isImmersive ? (
          // Barra de páginas: aparece con el chrome (tap) y permite saltar viendo la numeración.
          <View style={[styles.pageScrubber, { backgroundColor: colors.surface }]}>
            {/* Página Y porcentaje: la biblioteca muestra el avance en %, así que el
                lector tiene que decir lo mismo. Antes acá solo estaba "5 / 24" y el
                % aparecía únicamente en pantalla completa. */}
            <View style={styles.pageScrubberLabelBox}>
              <Text style={[styles.pageScrubberLabel, { color: colors.text }]}>
                {pdfPageForUi + 1} / {pageInfo.pageCount}
              </Text>
              <Text style={[styles.pageScrubberPercent, { color: colors.textMuted }]}>
                {pagePercentage(pdfPageForUi, pageInfo.pageCount).toFixed(0)} %
              </Text>
            </View>
            <Slider
              style={styles.pageScrubberSlider}
              minimumValue={0}
              maximumValue={Math.max(pageInfo.pageCount - 1, 0)}
              step={1}
              value={pdfPageForUi}
              minimumTrackTintColor={colors.warm}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.warm}
              onSlidingComplete={(value) => {
                pdfListRef.current?.scrollToPage(Math.round(value));
              }}
            />
          </View>
        ) : null}
        {(isImmersive || !pageInfo) ? (
          <View pointerEvents="none" style={styles.readOverlay}>
            <Text style={styles.readOverlayText} numberOfLines={1}>
              {pageInfo && pageInfo.pageCount > 0
                ? `${Math.round(((pdfPageForUi + 1) / pageInfo.pageCount) * 100)} % · pág. ${pdfPageForUi + 1}/${pageInfo.pageCount}`
                : pagedInfo && pagedInfo.pageCount > 0
                  // PDF leído como texto: el avance se mide en páginas, igual que en la biblioteca.
                  ? `${pagePercentage(pageForChar(currentAbsoluteChar, pagedInfo.pageOffsets), pagedInfo.pageCount).toFixed(0)} % · pág. ${pageForChar(currentAbsoluteChar, pagedInfo.pageOffsets) + 1}${currentChapter ? ` · ${shortTitle(currentChapter.title, 18)}` : ''}`
                  : `${reader.progressPercentage.toFixed(0)} %${currentChapter ? ` · ${shortTitle(currentChapter.title)}` : ''}`}
            </Text>
          </View>
        ) : null}

        {/* Chip: por dónde va la voz (tap = saltar a esa página). */}
        {reader.isPlaying && audioPage !== null && audioPage !== pdfPageForUi ? (
          <TouchableOpacity
            style={[styles.audioPageChip, { backgroundColor: colors.primary }]}
            onPress={() => pdfListRef.current?.scrollToPage(audioPage)}
          >
            <Icon name="volume-high" size={14} color={colors.primaryText} />
            <Text style={[styles.audioPageChipText, { color: colors.primaryText }]}>pág. {audioPage + 1}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Transporte de audio: parar · 15 s atrás · 15 s adelante. Solo mientras hay audio. */}
        {canNarrate && (reader.isPlaying || reader.isPreparing || isAudioLoaded) ? (
          <View style={styles.audioBar} pointerEvents="box-none">
            {speechError ? (
              <Text style={[styles.audioBarError, { backgroundColor: colors.danger }]} numberOfLines={2}>{speechError}</Text>
            ) : null}
            <View style={[styles.audioBarRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <IconButton name="stop" label="Detener" onPress={() => { void handleStop().catch(() => {}); }} colors={colors} />
              <IconButton name="play-back" label="15 segundos atrás" onPress={() => { void documentAudioPlaybackService.seekBy(-15); }} colors={colors} />
              <Text style={[styles.audioRate, { color: colors.textMuted }]}>{formatRate(effectiveRate)}</Text>
              <IconButton name="play-forward" label="15 segundos adelante" onPress={() => { void documentAudioPlaybackService.seekBy(15); }} colors={colors} />
            </View>
          </View>
        ) : null}

        {!canNarrate && !isImmersive && !isComicBook ? (
          <View pointerEvents="none" style={styles.scanNotice}>
            <Text style={styles.scanNoticeText}>
              {isTextPending
                ? `Preparando voz y búsqueda…${textPrepPercent ? ` ${textPrepPercent} %` : ''}`
                : 'PDF escaneado: sin texto para la voz'}
            </Text>
          </View>
        ) : null}

        {isAtEnd && nextBook && !nextDismissed ? (
          <View style={[styles.nextCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.nextText}>
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>SIGUE EN LA SAGA</Text>
              <Text style={[styles.nextTitle, { color: colors.text }]} numberOfLines={2}>
                {getDisplayTitle(nextBook)}
              </Text>
            </View>
            <IconButton name="close" label="No, gracias" onPress={() => setNextDismissed(true)} colors={colors} />
            <AppButton label="Abrir" icon="arrow-forward" onPress={openNextBook} colors={colors} compact />
          </View>
        ) : null}

        {/* Play flotante. En pantalla completa se oculta si no hay audio. */}
        {canNarrate && (!isImmersive || reader.isPlaying || reader.isPreparing) ? (
          <TouchableOpacity
            style={[styles.playFab, { backgroundColor: colors.primary }]}
            onPress={() => { void handleTogglePlayback(); }}
            disabled={reader.isPreparing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={reader.isPlaying ? 'Pausar narración' : 'Escuchar en voz alta'}
          >
            {reader.isPreparing ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Icon name={reader.isPlaying ? 'pause' : 'play'} size={28} color={colors.primaryText} style={reader.isPlaying ? undefined : styles.playFabIconOffset} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Barra inferior: lo que se usa todo el tiempo, siempre en el mismo lugar. */}
      {!isImmersive ? (
        <View style={[styles.toolbar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconButton name="list-outline" label="Índice" showLabel onPress={() => setActiveSheet('index')} colors={colors} disabled={!hasChapters} />
          <IconButton
            name="search-outline"
            label="Buscar"
            showLabel
            onPress={() => {
              if (isTextPending) showFlash('El texto todavía se está preparando');
              else if (!canNarrate) showFlash(isComicBook ? 'Un cómic no tiene texto para buscar' : 'Este PDF no tiene texto para buscar');
              else setIsSearchVisible(true);
            }}
            colors={colors}
          />
          <IconButton name="text-outline" label="Aspecto" showLabel onPress={() => setActiveSheet('look')} colors={colors} />
          <IconButton name="headset-outline" label="Voz" showLabel onPress={() => setActiveSheet('audio')} colors={colors} disabled={!canNarrate} />
          <IconButton name="expand-outline" label="Pantalla" showLabel onPress={handleToggleImmersive} colors={colors} />
        </View>
      ) : null}

      {/* Índice del libro: capítulos reales (o detectados), con el actual marcado. */}
      <Sheet visible={activeSheet === 'index'} onClose={() => setActiveSheet('none')} colors={colors} title="Índice" scroll={false} maxHeight="75%">
        <FlatList
          data={parsedDocument.chapters}
          keyExtractor={(chapter) => chapter.id}
          initialScrollIndex={currentChapter ? Math.max(0, Math.min(currentChapter.orderIndex, parsedDocument.chapters.length - 1)) : 0}
          getItemLayout={(_, index) => ({ length: INDEX_ROW_HEIGHT, offset: INDEX_ROW_HEIGHT * index, index })}
          style={styles.indexList}
          renderItem={({ item }) => {
            const isCurrent = currentChapter?.id === item.id;
            return (
              <Pressable
                onPress={() => { setActiveSheet('none'); jumpToChar(item.startChar); }}
                style={({ pressed }) => [
                  styles.indexRow,
                  { borderBottomColor: colors.border, backgroundColor: isCurrent ? colors.accent : pressed ? colors.surfaceMuted : 'transparent' },
                ]}
              >
                <Text style={[styles.indexTitle, { color: isCurrent ? colors.primary : colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {pageInfo ? (
                  <Text style={[styles.indexPage, { color: colors.textMuted }]}>{pageForChar(item.startChar, pageInfo.pageOffsets) + 1}</Text>
                ) : (
                  <Text style={[styles.indexPage, { color: colors.textMuted }]}>{Math.round((item.startChar / Math.max(parsedDocument.fullText.length, 1)) * 100)} %</Text>
                )}
              </Pressable>
            );
          }}
        />
      </Sheet>

      {/* Aspecto: tema, letra, brillo y márgenes. */}
      <Sheet visible={activeSheet === 'look'} onClose={() => setActiveSheet('none')} colors={colors} title="Aspecto">
        <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>TEMA</Text>
        <View style={styles.chipRow}>
          {READING_THEMES.map((theme) => (
            <Chip
              key={theme}
              label={READING_THEME_LABELS[theme]}
              icon={theme === 'auto' ? 'contrast-outline' : theme === 'day' ? 'sunny-outline' : theme === 'sepia' ? 'cafe-outline' : 'moon-outline'}
              active={settings.readingTheme === theme}
              onPress={() => { void updateSettings({ readingTheme: theme }); }}
              colors={colors}
            />
          ))}
        </View>
        {canReflow ? (
          <>
            <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>CÓMO VER EL PDF</Text>
            <View style={styles.chipRow}>
              <Chip label="Páginas" icon="document-outline" active={!settings.pdfAsText} onPress={() => { if (settings.pdfAsText) handleToggleReflow(); }} colors={colors} />
              <Chip label="Texto corrido" icon="reorder-four-outline" active={settings.pdfAsText} onPress={() => { if (!settings.pdfAsText) handleToggleReflow(); }} colors={colors} />
            </View>
          </>
        ) : null}
        <View style={[styles.sheetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {!pageInfo ? (
            <>
              <Row
                icon="text-outline"
                title="Tamaño de letra"
                colors={colors}
                right={
                  <Stepper
                    value={`${settings.fontSize}`}
                    onDecrease={() => { void updateSettings({ fontSize: Math.max(MIN_FONT_SIZE, settings.fontSize - 1) }); }}
                    onIncrease={() => { void updateSettings({ fontSize: Math.min(MAX_FONT_SIZE, settings.fontSize + 1) }); }}
                    canDecrease={settings.fontSize > MIN_FONT_SIZE}
                    canIncrease={settings.fontSize < MAX_FONT_SIZE}
                    colors={colors}
                  />
                }
              />
              <Row
                icon="play-forward-outline"
                title="Auto-scroll"
                subtitle={settings.autoScrollSpeed > 0 ? 'La página baja sola mientras leés' : undefined}
                colors={colors}
                right={
                  <Stepper
                    value={autoScrollLabel(settings.autoScrollSpeed)}
                    onDecrease={() => { void updateSettings({ autoScrollSpeed: stepAutoScroll(settings.autoScrollSpeed, -1) }); }}
                    onIncrease={() => { void updateSettings({ autoScrollSpeed: stepAutoScroll(settings.autoScrollSpeed, 1) }); }}
                    canDecrease={settings.autoScrollSpeed > AUTO_SCROLL_SPEEDS[0]}
                    canIncrease={settings.autoScrollSpeed < AUTO_SCROLL_SPEEDS[AUTO_SCROLL_SPEEDS.length - 1]}
                    colors={colors}
                  />
                }
              />
              <Row
                icon="code-outline"
                title="Márgenes"
                colors={colors}
                right={
                  <Stepper
                    value={`${settings.textMargin}`}
                    onDecrease={() => { void updateSettings({ textMargin: Math.max(MIN_TEXT_MARGIN, settings.textMargin - TEXT_MARGIN_STEP) }); }}
                    onIncrease={() => { void updateSettings({ textMargin: Math.min(MAX_TEXT_MARGIN, settings.textMargin + TEXT_MARGIN_STEP) }); }}
                    canDecrease={settings.textMargin > MIN_TEXT_MARGIN}
                    canIncrease={settings.textMargin < MAX_TEXT_MARGIN}
                    colors={colors}
                  />
                }
              />
              <Row
                icon="resize-outline"
                title="Interlineado"
                colors={colors}
                right={
                  <Stepper
                    value={`${settings.lineHeight.toFixed(1)}`}
                    onDecrease={() => { void updateSettings({ lineHeight: Math.max(MIN_LINE_HEIGHT, Math.round((settings.lineHeight - 0.1) * 10) / 10) }); }}
                    onIncrease={() => { void updateSettings({ lineHeight: Math.min(MAX_LINE_HEIGHT, Math.round((settings.lineHeight + 0.1) * 10) / 10) }); }}
                    canDecrease={settings.lineHeight > MIN_LINE_HEIGHT + 0.01}
                    canIncrease={settings.lineHeight < MAX_LINE_HEIGHT - 0.01}
                    colors={colors}
                  />
                }
              />
              <Row
                icon="language-outline"
                title="Tipografía"
                colors={colors}
                right={
                  <View style={styles.chipRow}>
                    <Chip label="Sans" active={settings.fontFamily === 'sans'} onPress={() => { void updateSettings({ fontFamily: 'sans' }); }} colors={colors} />
                    <Chip label="Serif" active={settings.fontFamily === 'serif'} onPress={() => { void updateSettings({ fontFamily: 'serif' }); }} colors={colors} />
                  </View>
                }
              />
              <Row
                icon="menu-outline"
                title="Justificar"
                colors={colors}
                onPress={() => { void updateSettings({ justifyText: !settings.justifyText }); }}
                right={<Icon name={settings.justifyText ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={settings.justifyText ? colors.primary : colors.border} />}
              />
            </>
          ) : null}
          <Row
            icon="moon-outline"
            title="Atenuar pantalla"
            subtitle="Por debajo del brillo mínimo del sistema"
            colors={colors}
            right={
              <Stepper
                value={`${Math.round(settings.screenDim * 100)} %`}
                onDecrease={() => { void handleDimChange(-DIM_STEP); }}
                onIncrease={() => { void handleDimChange(DIM_STEP); }}
                canDecrease={settings.screenDim > 0}
                canIncrease={settings.screenDim < MAX_DIM}
                colors={colors}
              />
            }
          />
          <Row
            icon="swap-horizontal-outline"
            title="Tocar los bordes pasa de página"
            subtitle="El centro sigue siendo pantalla completa"
            colors={colors}
            onPress={() => { void updateSettings({ tapEdgesTurnPage: !settings.tapEdgesTurnPage }); }}
            right={<Icon name={settings.tapEdgesTurnPage ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={settings.tapEdgesTurnPage ? colors.primary : colors.border} />}
            last={!pageInfo}
          />
          {/* Pasar de costado sólo tiene sentido cuando hay páginas dibujadas:
              en texto corrido se scrollea, no se pasa de hoja. */}
          {pageInfo ? (
            <Row
              icon="swap-horizontal"
              title="Pasar de costado"
              subtitle="Una página por vez, como pasar una hoja"
              colors={colors}
              onPress={() => { void updateSettings({ horizontalPages: !settings.horizontalPages }); }}
              right={<Icon name={settings.horizontalPages ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={settings.horizontalPages ? colors.primary : colors.border} />}
              last={!pageInfo.crop}
            />
          ) : null}
          {pageInfo?.crop ? (
            <Row
              icon="crop-outline"
              title="Recortar márgenes"
              subtitle="Quita el borde blanco de las páginas"
              colors={colors}
              onPress={() => { void updateSettings({ cropPdfMargins: !settings.cropPdfMargins }); }}
              right={<Icon name={settings.cropPdfMargins ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={settings.cropPdfMargins ? colors.primary : colors.border} />}
              last
            />
          ) : null}
        </View>
      </Sheet>

      {/* Voz: velocidad, temporizador y acceso a la voz elegida. */}
      <Sheet visible={activeSheet === 'audio'} onClose={() => setActiveSheet('none')} colors={colors} title="Voz">
        <View style={[styles.sheetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Row
            icon="speedometer-outline"
            title="Velocidad"
            subtitle={documentRecord?.rate != null ? 'Propia de este libro · tocá para volver a la general' : 'La general de Ajustes'}
            colors={colors}
            onPress={documentRecord?.rate != null ? () => { void handleResetRate(); } : undefined}
            right={
              <Stepper
                value={formatRate(effectiveRate)}
                onDecrease={() => { void handleRateChange(-1); }}
                onIncrease={() => { void handleRateChange(1); }}
                canDecrease={effectiveRate > MIN_RATE + 0.001}
                canIncrease={effectiveRate < MAX_RATE - 0.001}
                disabled={reader.isPreparing}
                colors={colors}
              />
            }
          />
          <Row
            icon="chatbox-ellipses-outline"
            title="Marcar lo que está sonando"
            subtitle="Guarda como cita la oración que la voz dice ahora"
            colors={colors}
            onPress={() => { void handleMarkSpoken(); }}
          />
          <Row
            icon="alarm-outline"
            title="Temporizador de sueño"
            subtitle={
              stopAtChar !== null
                ? 'Se apaga al terminar el capítulo'
                : sleepTimerLabel
                  ? `La voz se apaga en ${sleepTimerLabel}`
                  : 'Apagado'
            }
            colors={colors}
            onPress={() => { setActiveSheet('none'); setIsSleepTimerPickerVisible(true); }}
          />
          <Row
            icon="mic-outline"
            title="Voz e idioma"
            subtitle="Elegir la voz del teléfono y probarla"
            colors={colors}
            onPress={() => { setActiveSheet('none'); router.push('/settings'); }}
            last={!hasChapters}
          />
          {hasChapters ? (
            <Row
              icon="git-branch-outline"
              title="Capítulo"
              subtitle={currentChapter ? currentChapter.title : '—'}
              colors={colors}
              right={
                <View style={styles.inlineActions}>
                  <IconButton name="play-skip-back-outline" label="Capítulo anterior" onPress={handlePreviousChapter} colors={colors} disabled={!hasPreviousChapter || reader.isPreparing} />
                  <IconButton name="play-skip-forward-outline" label="Capítulo siguiente" onPress={handleNextChapter} colors={colors} disabled={!hasNextChapter || reader.isPreparing} />
                </View>
              }
              last
            />
          ) : null}
        </View>
        {isAudioLoaded || reader.isPlaying ? (
          <AppButton label="Detener y descargar el audio" icon="stop-circle-outline" onPress={() => { setActiveSheet('none'); void handleStop().catch(() => {}); }} variant="secondary" colors={colors} />
        ) : null}
      </Sheet>

      {/* "Dónde quedaste": aparece una sola vez al volver después de días. */}
      <Sheet visible={resumeHint !== null} onClose={() => setResumeHint(null)} colors={colors} top>
        <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>DONDE QUEDASTE</Text>
        <Text style={[styles.annotationExcerpt, { color: colors.text }]} numberOfLines={6}>
          {resumeHint?.excerpt}
        </Text>
        {resumeHint && resumeHint.notes.length > 0 ? (
          <>
            <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>LO QUE HABÍAS ANOTADO</Text>
            {resumeHint.notes.map((note) => (
              <Text key={note.id} style={[styles.resumeNote, { color: colors.textMuted }]} numberOfLines={3}>
                · {note.comment?.trim() || note.body?.trim() || 'Marcador'}
              </Text>
            ))}
          </>
        ) : null}
        <AppButton label="Seguir leyendo" icon="book-outline" onPress={() => setResumeHint(null)} colors={colors} />
      </Sheet>

      {/* Anotar un párrafo o una página: marcador, cita o nota. */}
      <Sheet visible={annotationTarget !== null} onClose={() => setAnnotationTarget(null)} colors={colors} top>
        <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>
          {annotationTarget?.page !== null && annotationTarget?.page !== undefined ? `PÁGINA ${annotationTarget.page + 1}` : 'ESTE PÁRRAFO'}
        </Text>
        {/* selectable: mantener apretado acá copia la cita, que es la mitad del
            sentido de citar exacto. */}
        <Text selectable style={[styles.annotationExcerpt, { color: colors.textMuted }]} numberOfLines={6}>
          {annotationTarget?.excerpt}
        </Text>
        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          placeholder="Escribí una nota (opcional para la cita)"
          placeholderTextColor={colors.textMuted}
          multiline
          style={[styles.annotationInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
        />
        <View style={styles.inlineActions}>
          <AppButton label="Marcador" icon="bookmark-outline" onPress={() => { void handleSaveAnnotation('bookmark'); }} variant="secondary" colors={colors} compact />
          <AppButton label="Cita" icon="chatbox-ellipses-outline" onPress={() => { void handleSaveAnnotation('quote'); }} variant="secondary" colors={colors} compact />
          <AppButton label="Nota" icon="create-outline" onPress={() => { void handleSaveAnnotation('note'); }} colors={colors} compact disabled={!noteDraft.trim()} />
        </View>
      </Sheet>

      {/* Buscar en el libro (sin distinguir tildes ni mayúsculas). */}
      <Sheet visible={isSearchVisible} onClose={() => setIsSearchVisible(false)} colors={colors} top maxHeight="52%" scroll={false}>
        <View style={styles.inlineActions}>
          <View style={[styles.searchField, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
            <Icon name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleRunSearch}
              placeholder="Buscar en el libro"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              autoFocus
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <AppButton label="Buscar" onPress={handleRunSearch} colors={colors} compact disabled={searchQuery.trim().length < 2} />
        </View>
        {searchResults !== null ? (
          <Text style={[styles.searchCount, { color: colors.textMuted }]}>
            {searchResults.length === 0
              ? 'Sin resultados.'
              : `${searchResults.length}${searchResults.length >= 200 ? '+' : ''} resultado${searchResults.length === 1 ? '' : 's'}`}
          </Text>
        ) : null}
        <FlatList
          data={searchResults ?? []}
          keyExtractor={(item) => String(item.index)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.searchRow, { borderColor: colors.border }]}
              onPress={() => { setIsSearchVisible(false); jumpToChar(item.index); }}
            >
              <Text style={[styles.searchSnippet, { color: colors.textMuted }]} numberOfLines={3}>
                {item.snippet.slice(0, item.snippetMatchStart)}
                <Text style={{ color: colors.text, fontWeight: '800', backgroundColor: colors.highlight }}>
                  {item.snippet.slice(item.snippetMatchStart, item.snippetMatchStart + item.matchLength)}
                </Text>
                {item.snippet.slice(item.snippetMatchStart + item.matchLength)}
              </Text>
              {pageInfo ? (
                <Text style={[styles.searchPage, { color: colors.primary }]}>
                  pág. {pageForChar(item.index, pageInfo.pageOffsets) + 1}
                </Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
      </Sheet>


      {flashMessage ? (
        <View pointerEvents="none" style={styles.flash}>
          <Text style={styles.flashText}>{flashMessage}</Text>
        </View>
      ) : null}

      {/* Brillo por debajo del mínimo del sistema: velo negro que no recibe toques. */}
      {settings.screenDim > 0 ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: settings.screenDim }]} />
      ) : null}

      <OptionPickerModal
        title="Temporizador de sueño"
        visible={isSleepTimerPickerVisible}
        colors={colors}
        selectedValue={sleepTimerMinutes ? String(sleepTimerMinutes) : 'off'}
        options={sleepTimerOptions}
        onClose={() => setIsSleepTimerPickerVisible(false)}
        onSelect={handleSleepTimerChange}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centeredContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 16 },
  summaryCard: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 16, marginTop: 8, gap: 8 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryCopy: { flex: 1, gap: 4 },
  fileName: { flex: 1, fontSize: 19, fontWeight: '700' },
  chapterTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  summaryText: { fontSize: 12, lineHeight: 17 },
  cacheLabel: { fontSize: 11, lineHeight: 16 },
  statusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  warningText: { fontSize: 12, lineHeight: 17 },
  noticeBox: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  preparingTrack: { height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 10 },
  preparingFill: { height: '100%', borderRadius: 999 },
  progressTrack: { height: 7, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  readerStage: { flex: 1, marginHorizontal: 10, marginTop: 10, marginBottom: 10, borderWidth: 1, borderRadius: 26, overflow: 'hidden' },
  readerStageImmersive: { marginHorizontal: 0, marginTop: 0, marginBottom: 0, borderWidth: 0, borderRadius: 0 },
  readerList: { flex: 1 },
  listContent: { paddingTop: 16, paddingBottom: 24 },
  controlPanel: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8 },
  modeToggle: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  modeToggleText: { fontSize: 13, fontWeight: '700' },
  // Indicador de avance flotante, casi transparente: informa sin molestar.
  // Autocontenido (oscuro + blanco): no se pierde sobre páginas blancas.
  readOverlay: {
    position: 'absolute',
    top: 8,
    right: 12,
    maxWidth: '70%',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(20,20,20,0.5)',
  },
  readOverlayText: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
  // Empieza a la derecha del número de página (abajo a la izquierda) y termina antes del play.
  audioBar: { position: 'absolute', left: 66, right: 90, bottom: 12, alignItems: 'flex-start', gap: 6 },
  playFab: {
    position: 'absolute',
    right: 14,
    bottom: 12,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  playFabIcon: { fontSize: 22, color: '#ffffff', fontWeight: '700' },
  audioPageChip: {
    position: 'absolute',
    bottom: 82,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  audioPageChipText: { fontSize: 12, fontWeight: '700' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet: { borderTopWidth: 1, borderRadius: 20, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 8 },
  menuHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', marginBottom: 6 },
  headerMenuButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginRight: 4 },
  headerMenuLabel: { fontSize: 14, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resumeNote: { fontSize: 13.5, lineHeight: 19 },
  nextCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
  },
  nextText: { flex: 1, gap: 2 },
  nextTitle: { fontSize: 15, fontWeight: '700' },
  annotationExcerpt: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  annotationInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  topBackdrop: { justifyContent: 'flex-start', paddingTop: 56, paddingHorizontal: 12 },
  topSheet: { borderWidth: 1, borderRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, paddingTop: 16, paddingBottom: 16 },
  // Media pantalla como mucho: la otra mitad es del teclado.
  searchSheet: { maxHeight: '48%' },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 15 },
  searchCount: { fontSize: 12 },
  searchRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 3 },
  searchSnippet: { fontSize: 13.5, lineHeight: 19 },
  searchPage: { fontSize: 11, fontWeight: '700' },
  flash: { position: 'absolute', top: 70, alignSelf: 'center', backgroundColor: 'rgba(20,20,20,0.85)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  flashText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  scanNotice: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: 'rgba(20,20,20,0.6)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  scanNoticeText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  audioBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 2,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  audioBarMain: { minWidth: 128 },
  audioBarGhostLabel: { color: '#ffffff' },
  audioBarError: {
    color: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
  },
  pageScrubber: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    opacity: 0.88,
  },
  pageScrubberLabelBox: { minWidth: 64 },
  pageScrubberLabel: { fontSize: 12, fontWeight: '700' },
  pageScrubberPercent: { fontSize: 11, fontWeight: '600' },
  pageScrubberSlider: { flex: 1, height: 32 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideControl: { flex: 0.9 },
  mainControl: { flex: 1.2 },
  playButton: { minHeight: 46, borderRadius: 18 },
  playButtonLabel: { fontSize: 15 },
  sliderGroup: { gap: 6 },
  controlsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  secondaryControlsCard: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sliderLabel: { fontSize: 12 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  settingLabel: { fontSize: 14, fontWeight: '600' },
  inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineValue: { minWidth: 52, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  resumeText: { fontSize: 12, flex: 1, lineHeight: 17 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  indexList: { maxHeight: 520 },
  indexRow: { height: INDEX_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  indexTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  indexPage: { fontSize: 12.5, fontWeight: '600' },
  sheetLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  audioRate: { fontSize: 12.5, fontWeight: '700', minWidth: 44, textAlign: 'center' },
  playFabIconOffset: { marginLeft: 3 },
  searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10 },
  errorCard: { width: '100%', borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  errorTitle: { fontSize: 20, fontWeight: '700' },
  errorMessage: { fontSize: 15, lineHeight: 22 },
});
