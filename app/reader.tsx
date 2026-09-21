import Slider from '@react-native-community/slider';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { ReaderBlockCard } from '../src/components/ReaderBlockCard';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { useReaderController } from '../src/hooks/useReaderController';
import { DocumentParseError, getFriendlyParseErrorMessage } from '../src/services/documentParser';
import { persistBookMetadata } from '../src/services/bookMetadataService';
import { ensureLocalPdfCopy } from '../src/services/libraryScanService';
import { documentAudioPlaybackService } from '../src/services/documentAudioPlaybackService';
import { closePdf, renderPdfCover } from '../src/services/pdfLocalService';
import { readerJumpStore } from '../src/services/readerJumpStore';
import { PdfPageList, PdfPageListHandle } from '../src/components/PdfPageList';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../src/utils/documentProgress';
import { charForPage, pageForChar } from '../src/utils/pageMap';
import { getDisplayTitle } from '../src/utils/bookDisplay';
import { getParserForDocument } from '../src/services/parserRegistry';
import { bookRepository } from '../src/storage/bookRepository';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { noteRepository } from '../src/storage/noteRepository';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';
import { Book, BookNote, NoteType, ReadingProgress, ReadingTheme } from '../src/types/storage';
import { ParsedDocument, TextBlock } from '../src/types/document';
import { detectChapters } from '../src/utils/chapterDetector';
import { chaptersFromOutline, chaptersFromToc } from '../src/utils/pdfOutline';
import { clampRounded } from '../src/utils/math';
import { SearchMatch, foldText, searchText } from '../src/utils/textSearch';
import { ThemeColors, getReaderColors, resolveReadingMode } from '../src/utils/theme';

/**
 * Capítulos del libro: primero el índice real (marcadores del PDF o índice del
 * EPUB); si no trae, la detección sobre el texto (encabezados POV, etc.).
 */
function resolveChapters(bookId: string, doc: ParsedDocument) {
  if (doc.pdf) {
    const fromOutline = chaptersFromOutline(bookId, doc.pdf.outline, doc.pdf.pageOffsets, doc.fullText.length);
    if (fromOutline.length > 0) return fromOutline;
  }
  if (doc.toc) {
    const fromToc = chaptersFromToc(bookId, doc.toc, doc.fullText.length);
    if (fromToc.length > 0) return fromToc;
  }
  return detectChapters(bookId, doc.fullText);
}

const KEEP_AWAKE_TAG = 'reader-screen';
const READING_THEMES: ReadingTheme[] = ['auto', 'day', 'sepia', 'night'];
const READING_THEME_LABELS: Record<ReadingTheme, string> = { auto: 'Auto', day: 'Día', sepia: 'Sepia', night: 'Noche' };
const MAX_QUOTE_CHARS = 1200;
const DIM_STEP = 0.1;
const MAX_DIM = 0.8;

/** Dónde se quiere anotar: un párrafo (texto) o una página (PDF). */
type AnnotationTarget = { charIndex: number; page: number | null; excerpt: string };
const MIN_RATE = 0.6;
const MAX_RATE = 1.6;

type StatusTone = 'primary' | 'neutral' | 'warning' | 'danger';

function formatRateLabel(rate: number) {
  return `${rate.toFixed(2)}x`;
}

function formatRemainingTime(deadlineAt: number | null, now: number) {
  if (!deadlineAt) return 'Sin temporizador';
  const remainingMs = Math.max(0, deadlineAt - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Dormir en ${minutes}:${seconds.toString().padStart(2, '0')}`;
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
  const [annotationTarget, setAnnotationTarget] = useState<AnnotationTarget | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const foldedTextRef = useRef<{ docId: string; folded: string } | null>(null);
  const [documentRecord, setDocumentRecord] = useState<Book | null>(null);
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [savedProgress, setSavedProgress] = useState<ReadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Abriendo el documento…');
  // Vista única: SIEMPRE se ve el libro (páginas del PDF o texto) y el audio se
  // controla con la barra flotante + el menú ⋯. No hay "pantalla de escucha".
  const [pdfPageForUi, setPdfPageForUi] = useState(0);
  // Pantalla completa en modo lectura: tocás la página y desaparece el chrome.
  const [isImmersive, setIsImmersive] = useState(false);
  const currentPdfPageRef = useRef(0);
  const pdfListRef = useRef<PdfPageListHandle>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSleepTimerPickerVisible, setIsSleepTimerPickerVisible] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepDeadlineAt, setSleepDeadlineAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [isUsingCachedText, setIsUsingCachedText] = useState(false);
  const listRef = useRef<FlatList<TextBlock>>(null);

  useEffect(() => {
    let isMounted = true;
    const loadDocument = async () => {
      let isGuardArmed = false;
      if (!documentId) {
        setParseError('No llego un documento valido para abrir.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setLoadingStatus('Abriendo el documento…');
      setParseError(null);
      setSpeechError(null);
      setIsUsingCachedText(false);
      try {
        const [book, progress] = await Promise.all([
          bookRepository.getBookById(documentId),
          bookProgressRepository.getProgress(documentId),
        ]);
        if (!book) throw new DocumentParseError('missing_file', 'El documento ya no figura en la base local de recientes.');
        await bookRepository.touchBook(book.id);
        // Título disponible ya durante la carga (para el header y para saber qué se abre).
        if (isMounted) setDocumentRecord(book);
        await runtimeStateRepository.armReaderLoadGuard(book.id);
        isGuardArmed = true;
        // Si se pidió abrir en una posición (índice, cita, marcador), gana sobre
        // el progreso guardado.
        const withPendingJump = (doc: ParsedDocument, saved: ReadingProgress | null): ReadingProgress | null => {
          const jump = readerJumpStore.consume(book.id);
          if (jump === null) return saved;
          const pos = getPositionFromAbsoluteChar(doc, jump);
          return {
            bookId: book.id,
            chapterId: null,
            blockIndex: pos.blockIndex,
            charIndex: pos.charIndex,
            percentage: pos.percentage,
            updatedAt: new Date().toISOString(),
          };
        };
        const isPdf = book.type === 'application/pdf' || /\.pdf$/i.test(book.name);
        const cachedParsed = await parsedDocumentRepository.getParsedDocument(book);
        if (!isMounted) return;
        // Un PDF cacheado sin mapa de páginas viene de una versión anterior: se
        // re-procesa una vez para tener el lector visual y el seguimiento de voz.
        if (cachedParsed && (!isPdf || cachedParsed.pdf)) {
          const chapters = resolveChapters(book.id, cachedParsed);
          const parsedWithChapters = { ...cachedParsed, chapters };
          if (chapters.length > 0) void chapterRepository.saveChaptersForBook(book.id, chapters);
          setDocumentRecord(book);
          setSavedProgress(withPendingJump(parsedWithChapters, progress));
          setParsedDocument(parsedWithChapters);
          setIsUsingCachedText(true);
          return;
        }
        // Libros descubiertos por escaneo (content://): el extractor PDF
        // nativo necesita file://, así que se materializa una copia local
        // la primera vez y se actualiza la URI del libro.
        let effectiveBook = book;
        if (book.uri.startsWith('content://') && isPdf) {
          const localUri = await ensureLocalPdfCopy(book.id, book.uri);
          effectiveBook = { ...book, uri: localUri };
          await bookRepository.saveBook(effectiveBook);
        }
        const parser = getParserForDocument(effectiveBook.type, effectiveBook.name);
        const parsed = await parser.parse(effectiveBook.uri, (done, total) => {
          if (isMounted) setLoadingStatus(`Leyendo el libro… ${done} de ${total} páginas`);
        });
        const chapters = resolveChapters(book.id, parsed);
        const parsedWithChapters: ParsedDocument = {
          ...parsed,
          id: book.id,
          fileName: book.name,
          sourceUri: effectiveBook.uri,
          chapters,
        };
        if (chapters.length > 0) await chapterRepository.saveChaptersForBook(book.id, chapters);
        await parsedDocumentRepository.saveParsedDocument(effectiveBook, parsedWithChapters);
        // Metadata real (título, autor, portada) extraída en el parseo fresco.
        if (parsed.metadata) void persistBookMetadata(book.id, parsed.metadata);
        // La tapa de un PDF es su primera página, dibujada en el teléfono.
        if (isPdf && !book.coverUri) {
          void renderPdfCover(book.id, effectiveBook.uri).then((coverUri) => {
            if (coverUri) void bookRepository.updateBookMetadata(book.id, { title: null, author: null, coverUri });
          });
        }
        if (!isMounted) return;
        setDocumentRecord(effectiveBook);
        setSavedProgress(withPendingJump(parsedWithChapters, progress));
        setParsedDocument(parsedWithChapters);
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

  const persistProgress = useCallback(
    async (snapshot: { blockIndex: number; charIndex: number; percentage: number }) => {
      if (!documentId) return;
      await bookProgressRepository.saveProgress({
        bookId: documentId,
        chapterId: null,
        blockIndex: snapshot.blockIndex,
        charIndex: snapshot.charIndex,
        percentage: snapshot.percentage,
      });
    },
    [documentId],
  );

  const reader = useReaderController({
    document: parsedDocument,
    initialBlockIndex: savedProgress?.blockIndex ?? 0,
    initialCharIndex: savedProgress?.charIndex ?? 0,
    rate: settings.defaultRate,
    voiceId: settings.defaultVoiceId,
    onError: setSpeechError,
    onProgressChange: persistProgress,
  });

  // Si la voz está sonando, un error anterior ya no aplica (p. ej. faltaba la
  // voz, se instaló y el reintento anduvo): el cartel no debe quedar pegado.
  useEffect(() => {
    if (reader.isPlaying) setSpeechError(null);
  }, [reader.isPlaying]);

  // Detiene y descarga el audio (cierra lo que se está escuchando).
  const handleStop = useCallback(async () => {
    await documentAudioPlaybackService.stopAndUnload();
  }, []);

  // Estable (prop del visor memoizado): alterna pantalla completa.
  const handleToggleImmersive = useCallback(() => {
    setIsImmersive((v) => !v);
  }, []);

  // Lector visual: páginas reales del PDF, dibujadas en el teléfono.
  const pageInfo = parsedDocument?.pdf ?? null;
  // PDF escaneado: se lee la página, pero no hay texto que narrar.
  const canNarrate = pageInfo ? pageInfo.hasText : true;

  // "Escuchar" desde el Home: arranca la voz solo (una vez, al estar cargado).
  const autoListenRef = useRef(false);
  useEffect(() => {
    if (mode !== 'listen' || autoListenRef.current || !parsedDocument || isLoading || !canNarrate) return;
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
    return pageForChar(abs, pageInfo.pageOffsets);
  }, [pageInfo, savedProgress, parsedDocument]);

  useEffect(() => {
    currentPdfPageRef.current = initialPdfPage;
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
      void reader.syncPosition(pos.blockIndex, pos.charIndex);
    },
    [parsedDocument, pageInfo, reader.syncPosition],
  );

  // Modo texto (EPUB/TXT/DOCX): timestamp del ultimo scroll manual para que el
  // auto-scroll de la voz no secuestre la pantalla mientras leés por delante.
  const textScrolledAtRef = useRef(0);

  // Posicionar la lista de texto en un bloque. Los bloques tienen alto variable,
  // así que scrollToIndex a un bloque lejano (todavía no medido) falla, y estimar
  // el offset por alto promedio queda corto o largo. Lo determinista es REMONTAR
  // la lista anclada en el bloque destino: renderiza directamente desde ahí.
  const [textAnchor, setTextAnchor] = useState({ index: 0, nonce: 0 });
  // Mientras la lista se reposiciona sola, lo que queda "visible" no es una
  // decisión del usuario y NO debe guardarse como progreso.
  const suppressViewSyncUntilRef = useRef(0);
  const initialTextScrollDoneRef = useRef(false);

  const anchorTextAt = useCallback((index: number) => {
    suppressViewSyncUntilRef.current = Date.now() + 1500;
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

  const handleTextScrollFailed = useCallback(
    (info: { index: number }) => {
      anchorTextAt(info.index);
    },
    [anchorTextAt],
  );

  // Scroll manual en la lista de texto → guarda progreso (el bloque de arriba).
  // Identidad estable (RN prohíbe cambiar onViewableItemsChanged en caliente):
  // lee el controlador por ref, deps vacías.
  const handleTextViewable = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (isPlayingRef.current) return; // sonando manda el audio, no el scroll
      // Al abrir, la lista arranca arriba de todo: si eso se guardara, cada
      // reapertura pisaría el progreso con 0%. Recién cuenta el scroll del usuario.
      if (!initialTextScrollDoneRef.current || Date.now() < suppressViewSyncUntilRef.current) return;
      const topIndex = viewableItems.find((v) => v.index !== null)?.index;
      if (typeof topIndex === 'number') void readerRef.current.syncPosition(topIndex, 0);
    },
    [],
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

  // Modo texto: al abrir, ir a donde quedó la lectura.
  useEffect(() => {
    if (!parsedDocument || parsedDocument.pdf) return;
    initialTextScrollDoneRef.current = false;
    const index = Math.min(Math.max(savedProgress?.blockIndex ?? 0, 0), parsedDocument.blocks.length - 1);
    const startTimer = index > 0 ? setTimeout(() => scrollToBlock(index), 80) : null;
    // Se habilita el guardado por scroll cuando el salto inicial ya se asentó.
    const doneTimer = setTimeout(() => { initialTextScrollDoneRef.current = true; }, index > 0 ? 2200 : 600);
    return () => {
      if (startTimer) clearTimeout(startTimer);
      clearTimeout(doneTimer);
    };
  }, [parsedDocument, savedProgress, scrollToBlock]);

  const loadNotes = useCallback(async () => {
    if (!documentId) return;
    setNotes(await noteRepository.listForBook(documentId));
  }, [documentId]);

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
      if (parsedDocument.pdf) {
        pdfListRef.current?.scrollToPage(pageForChar(absoluteChar, parsedDocument.pdf.pageOffsets));
      } else {
        textScrolledAtRef.current = 0;
        scrollToBlock(pos.blockIndex);
      }
    },
    [parsedDocument, scrollToBlock],
  );

  // Al volver de "Sobre este libro": refresca anotaciones y aplica el salto pedido.
  useFocusEffect(
    useCallback(() => {
      void loadNotes();
      if (!parsedDocument) return;
      const jump = readerJumpStore.consume(parsedDocument.id);
      if (jump !== null) jumpToChar(jump);
    }, [loadNotes, parsedDocument, jumpToChar]),
  );

  // ¿Hay un marcador donde estoy? En PDF se compara por página; en texto, por párrafo.
  const bookmarkHere = useMemo(() => {
    if (!parsedDocument) return null;
    if (parsedDocument.pdf) {
      return notes.find((n) => n.type === 'bookmark' && n.page === pdfPageForUi) ?? null;
    }
    const block = parsedDocument.blocks[reader.currentBlockIndex];
    if (!block) return null;
    return notes.find((n) => n.type === 'bookmark' && n.charIndex >= block.startChar && n.charIndex < block.endChar) ?? null;
  }, [notes, parsedDocument, pdfPageForUi, reader.currentBlockIndex]);

  // Posición + extracto de lo que se está viendo ahora (para marcadores).
  const getCurrentTarget = useCallback((): AnnotationTarget | null => {
    if (!parsedDocument) return null;
    if (parsedDocument.pdf) {
      const page = currentPdfPageRef.current;
      const charIndex = charForPage(page, parsedDocument.pdf.pageOffsets, parsedDocument.fullText.length);
      return { charIndex, page, excerpt: parsedDocument.fullText.slice(charIndex, charIndex + 160).trim() };
    }
    const block = parsedDocument.blocks[readerRef.current.currentBlockIndex];
    if (!block) return null;
    return { charIndex: block.startChar, page: null, excerpt: block.text.slice(0, 160).trim() };
  }, [parsedDocument]);

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

  const handleLongPressPage = useCallback(
    (pageIndex: number) => {
      if (!parsedDocument?.pdf) return;
      const start = charForPage(pageIndex, parsedDocument.pdf.pageOffsets, parsedDocument.fullText.length);
      const nextStart =
        pageIndex + 1 < parsedDocument.pdf.pageOffsets.length
          ? parsedDocument.pdf.pageOffsets[pageIndex + 1]
          : parsedDocument.fullText.length;
      setNoteDraft('');
      setAnnotationTarget({
        charIndex: start,
        page: pageIndex,
        excerpt: parsedDocument.fullText.slice(start, Math.min(nextStart, start + MAX_QUOTE_CHARS)).trim(),
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

  const handleCycleTheme = useCallback(async () => {
    const index = READING_THEMES.indexOf(settings.readingTheme);
    await updateSettings({ readingTheme: READING_THEMES[(index + 1) % READING_THEMES.length] });
  }, [settings.readingTheme, updateSettings]);

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
        if (r.isPlaying) void r.stop();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepDeadlineAt]);

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

  const handleNextChapter = useCallback(() => {
    if (!parsedDocument?.chapters?.length || !currentChapter) return;
    const next = parsedDocument.chapters.find((ch) => ch.orderIndex === currentChapter.orderIndex + 1);
    if (!next) return;
    void reader.seekToBlock(findBlockForChar(next.startChar), reader.isPlaying);
  }, [parsedDocument, currentChapter, findBlockForChar, reader]);

  const handlePreviousChapter = useCallback(() => {
    if (!parsedDocument?.chapters?.length || !currentChapter) return;
    const prev = parsedDocument.chapters.find((ch) => ch.orderIndex === currentChapter.orderIndex - 1);
    if (!prev) return;
    void reader.seekToBlock(findBlockForChar(prev.startChar), reader.isPlaying);
  }, [parsedDocument, currentChapter, findBlockForChar, reader]);

  const sleepTimerOptions = useMemo(() => [
    { value: 'off', label: 'Sin temporizador', description: 'La lectura sigue hasta que la detengas.' },
    { value: '10', label: '10 minutos', description: 'Se detiene sola despues de diez minutos.' },
    { value: '20', label: '20 minutos', description: 'Se detiene sola despues de veinte minutos.' },
    { value: '30', label: '30 minutos', description: 'Se detiene sola despues de treinta minutos.' },
  ], []);

  const sleepTimerLabel = useMemo(() => formatRemainingTime(sleepDeadlineAt, clockNow), [clockNow, sleepDeadlineAt]);

  const readerStatus = useMemo(() => {
    if (parseError) return { label: parseError.includes('no contiene texto') ? 'PDF sin texto' : 'Error', tone: 'danger' as StatusTone };
    if (speechError) return { label: 'Error de voz', tone: 'danger' as StatusTone };
    if (reader.isPreparing) return { label: 'Preparando audio', tone: 'primary' as StatusTone };
    if (reader.isPlaying) return { label: 'Reproduciendo', tone: 'primary' as StatusTone };
    return { label: 'Detenido', tone: 'neutral' as StatusTone };
  }, [parseError, reader.isPlaying, reader.isPreparing, speechError]);

  const statusColors = getStatusColors(colors, readerStatus.tone);

  const handleRateChange = useCallback(
    async (delta: number) => {
      const nextRate = clampRounded(settings.defaultRate + delta, MIN_RATE, MAX_RATE);
      await updateSettings({ defaultRate: nextRate });
    },
    [settings.defaultRate, updateSettings],
  );

  const handleSleepTimerChange = useCallback((optionValue: string) => {
    setIsSleepTimerPickerVisible(false);
    if (optionValue === 'off') { setSleepTimerMinutes(null); setSleepDeadlineAt(null); return; }
    const minutes = Number(optionValue);
    if (!Number.isFinite(minutes) || minutes <= 0) { setSleepTimerMinutes(null); setSleepDeadlineAt(null); return; }
    setSleepTimerMinutes(minutes);
    setSleepDeadlineAt(Date.now() + minutes * 60 * 1000);
  }, []);

  const handleTogglePlayback = useCallback(async () => {
    if (reader.isPreparing) return;
    if (reader.isPlaying) { await reader.stop(); return; }
    await reader.play();
  }, [reader]);

  const handleSeekBlock = useCallback(async (blockIndex: number) => {
    await reader.seekToBlock(blockIndex, reader.isPlaying);
  }, [reader]);

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
          <Text style={[styles.errorTitle, { color: colors.text }]}>No se pudo abrir el documento</Text>
          <Text style={[styles.errorMessage, { color: colors.textMuted }]}>{parseError ?? 'El documento seleccionado no esta disponible.'}</Text>
          <AppButton label="Volver al inicio" onPress={() => router.replace('/')} colors={colors} />
        </View>
      </SafeAreaView>
    );
  }

  const hasChapters = Boolean(parsedDocument.chapters?.length);
  const hasPreviousChapter = hasChapters && Boolean(currentChapter && currentChapter.orderIndex > 0);
  const hasNextChapter = hasChapters && Boolean(currentChapter && currentChapter.orderIndex < (parsedDocument.chapters?.length ?? 0) - 1);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar hidden={isImmersive} />
      <Stack.Screen
        options={{
          title: documentRecord ? getDisplayTitle(documentRecord) : 'Lector',
          headerShown: !isImmersive,
          headerRight: () => (
            <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => { void handleToggleBookmark(); }}
              accessibilityRole="button"
              accessibilityLabel={bookmarkHere ? 'Quitar marcador' : 'Agregar marcador'}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={[
                styles.headerMenuButton,
                { borderColor: bookmarkHere ? colors.primary : colors.border, backgroundColor: bookmarkHere ? colors.accent : colors.surface },
              ]}
            >
              <Text style={[styles.headerMenuLabel, { color: colors.text }]}>{bookmarkHere ? '🔖' : '📑'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIsMenuVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Opciones del libro"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[styles.headerMenuButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={[styles.headerMenuLabel, { color: colors.text }]}>Menú</Text>
            </TouchableOpacity>
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
            sourceUri={documentRecord.uri}
            pageCount={pageInfo.pageCount}
            pageAspect={pageInfo.pageAspect}
            crop={settings.cropPdfMargins ? pageInfo.crop : null}
            colorMode={readingMode}
            initialPage={initialPdfPage}
            colors={readerColors}
            onPageChange={handlePdfPageChange}
            onTap={handleToggleImmersive}
            onLongPressPage={handleLongPressPage}
            speakingPage={reader.isPlaying ? audioPage : null}
          />
        ) : (
        <FlatList
          // La clave cambia en cada anclaje: la lista se remonta en ese bloque.
          key={`text-${textAnchor.nonce}`}
          initialScrollIndex={Math.min(textAnchor.index, parsedDocument.blocks.length - 1)}
          style={styles.readerList}
          ref={listRef}
          data={parsedDocument.blocks}
          keyExtractor={(item) => item.index.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => { textScrolledAtRef.current = Date.now(); }}
          onViewableItemsChanged={handleTextViewable}
          viewabilityConfig={textViewabilityConfig}
          onScrollToIndexFailed={handleTextScrollFailed}
          renderItem={({ item }) => (
            <ReaderBlockCard
              block={item}
              isActive={item.index === reader.currentBlockIndex}
              colors={readerColors}
              fontSize={settings.fontSize}
              wordRange={item.index === reader.currentBlockIndex ? reader.currentWordRange : null}
              onPress={() => { void handleSeekBlock(item.index); }}
              onLongPress={() => handleLongPressBlock(item)}
            />
          )}
        />
        )}
        {pageInfo && pageInfo.pageCount > 0 && !isImmersive ? (
          // Scrubber semi-transparente: aparece con el chrome (tap) y permite
          // saltar páginas viendo la numeración.
          <View style={[styles.pageScrubber, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pageScrubberLabel, { color: colors.text }]}>
              {pdfPageForUi + 1} / {pageInfo.pageCount}
            </Text>
            <Slider
              style={styles.pageScrubberSlider}
              minimumValue={0}
              maximumValue={Math.max(pageInfo.pageCount - 1, 0)}
              step={1}
              value={pdfPageForUi}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
              onSlidingComplete={(value) => {
                pdfListRef.current?.scrollToPage(Math.round(value));
              }}
            />
          </View>
        ) : null}
        {(isImmersive || !pageInfo) ? (
          <View pointerEvents="none" style={styles.readOverlay}>
            <Text style={styles.readOverlayText}>
              {pageInfo && pageInfo.pageCount > 0
                ? `${Math.round(((pdfPageForUi + 1) / pageInfo.pageCount) * 100)}% · pág. ${pdfPageForUi + 1}/${pageInfo.pageCount}`
                : `${reader.progressPercentage.toFixed(0)}%`}
            </Text>
          </View>
        ) : null}

        {/* Chip: por dónde va la voz (tap = saltar a esa página). */}
        {reader.isPlaying && audioPage !== null && audioPage !== pdfPageForUi ? (
          <TouchableOpacity
            style={styles.audioPageChip}
            onPress={() => pdfListRef.current?.scrollToPage(audioPage)}
          >
            <Text style={styles.audioPageChipText}>🔊 pág. {audioPage + 1} →</Text>
          </TouchableOpacity>
        ) : null}

        {/* Controles de audio: parar · atrás · adelante (el play vive en el FAB).
            Visibles con el chrome (tap) o mientras suena. */}
        {canNarrate && (!isImmersive || reader.isPlaying || reader.isPreparing) ? (
          <View style={styles.audioBar} pointerEvents="box-none">
            {speechError ? (
              <Text style={styles.audioBarError} numberOfLines={2}>{speechError}</Text>
            ) : null}
            <View style={styles.audioBarRow}>
              <AppButton
                label="■"
                onPress={() => { void handleStop(); }}
                variant="ghost"
                colors={colors}
                compact
                labelStyle={styles.audioBarGhostLabel}
              />
              <AppButton
                label="↩ 15"
                onPress={() => { void documentAudioPlaybackService.seekBy(-15); }}
                variant="secondary"
                colors={colors}
                compact
              />
              <AppButton
                label="15 ↪"
                onPress={() => { void documentAudioPlaybackService.seekBy(15); }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>
          </View>
        ) : null}

        {/* Play flotante. En pantalla completa se oculta si no hay audio, para
            que la lectura quede limpia y no tape el numero/marcador de pagina
            (que vive abajo a la izquierda). */}
        {!canNarrate && !isImmersive ? (
          <View pointerEvents="none" style={styles.scanNotice}>
            <Text style={styles.scanNoticeText}>PDF escaneado: sin texto para la voz</Text>
          </View>
        ) : null}

        {canNarrate && (!isImmersive || reader.isPlaying || reader.isPreparing) ? (
          <TouchableOpacity
            style={[styles.playFab, { backgroundColor: colors.primary }]}
            onPress={() => { void handleTogglePlayback(); }}
            disabled={reader.isPreparing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={reader.isPlaying ? 'Pausar narración' : 'Escuchar en voz alta'}
          >
            <Text style={styles.playFabIcon}>
              {reader.isPlaying ? '❚❚' : reader.isPreparing ? '…' : '▶'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Menú de opciones del lector (⋯ en la barra de audio). Rescata al diseño
          single-view lo útil que antes vivía en el panel de "modo escucha":
          capítulos, velocidad y temporizador. */}
      <Modal visible={isMenuVisible} transparent animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.menuHandle} />

            {hasChapters ? (
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Capítulo</Text>
                <View style={styles.inlineActions}>
                  <AppButton label="← Cap." onPress={handlePreviousChapter} variant="ghost" colors={colors} compact disabled={!hasPreviousChapter || reader.isPreparing} />
                  <Text style={[styles.inlineValue, { color: colors.text, fontSize: 12 }]} numberOfLines={1}>
                    {currentChapter ? `${currentChapter.orderIndex + 1}/${parsedDocument.chapters?.length ?? 0}` : '—'}
                  </Text>
                  <AppButton label="Cap. →" onPress={handleNextChapter} variant="ghost" colors={colors} compact disabled={!hasNextChapter || reader.isPreparing} />
                </View>
              </View>
            ) : null}

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Velocidad</Text>
              <View style={styles.inlineActions}>
                <AppButton label="-" onPress={() => { void handleRateChange(-0.1); }} variant="ghost" colors={colors} compact disabled={reader.isPreparing} />
                <Text style={[styles.inlineValue, { color: colors.text }]}>{formatRateLabel(settings.defaultRate)}</Text>
                <AppButton label="+" onPress={() => { void handleRateChange(0.1); }} variant="ghost" colors={colors} compact disabled={reader.isPreparing} />
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Temporizador de sueño</Text>
              <AppButton
                label={sleepTimerMinutes ? sleepTimerLabel : 'Off'}
                onPress={() => { setIsMenuVisible(false); setIsSleepTimerPickerVisible(true); }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Tema de lectura</Text>
              <AppButton
                label={READING_THEME_LABELS[settings.readingTheme]}
                onPress={() => { void handleCycleTheme(); }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Atenuar pantalla</Text>
              <View style={styles.inlineActions}>
                <AppButton label="-" onPress={() => { void handleDimChange(-DIM_STEP); }} variant="ghost" colors={colors} compact disabled={settings.screenDim <= 0} />
                <Text style={[styles.inlineValue, { color: colors.text }]}>{Math.round(settings.screenDim * 100)}%</Text>
                <AppButton label="+" onPress={() => { void handleDimChange(DIM_STEP); }} variant="ghost" colors={colors} compact disabled={settings.screenDim >= MAX_DIM} />
              </View>
            </View>

            {pageInfo?.crop ? (
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Recortar márgenes</Text>
                <AppButton
                  label={settings.cropPdfMargins ? 'Sí' : 'No'}
                  onPress={() => { void updateSettings({ cropPdfMargins: !settings.cropPdfMargins }); }}
                  variant="secondary"
                  colors={colors}
                  compact
                />
              </View>
            ) : null}

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Buscar en el libro</Text>
              <AppButton
                label="Buscar"
                onPress={() => { setIsMenuVisible(false); setIsSearchVisible(true); }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>
                Sobre este libro{notes.length > 0 ? ` · ${notes.length} anotaciones` : ''}
              </Text>
              <AppButton
                label="Abrir"
                onPress={() => {
                  setIsMenuVisible(false);
                  router.push({ pathname: '/book', params: { bookId: documentRecord.id, from: 'reader' } });
                }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            <AppButton label="Cerrar" onPress={() => setIsMenuVisible(false)} variant="ghost" colors={colors} compact fullWidth />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Anotar un párrafo o una página: marcador, cita o nota. */}
      <Modal visible={annotationTarget !== null} transparent animationType="fade" onRequestClose={() => setAnnotationTarget(null)}>
        <TouchableOpacity style={[styles.menuBackdrop, styles.topBackdrop]} activeOpacity={1} onPress={() => setAnnotationTarget(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.menuSheet, styles.topSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {annotationTarget?.page !== null && annotationTarget?.page !== undefined ? `Página ${annotationTarget.page + 1}` : 'Este párrafo'}
            </Text>
            <Text style={[styles.annotationExcerpt, { color: colors.textMuted }]} numberOfLines={4}>
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
              <AppButton label="🔖 Marcador" onPress={() => { void handleSaveAnnotation('bookmark'); }} variant="secondary" colors={colors} compact />
              <AppButton label="❝ Cita" onPress={() => { void handleSaveAnnotation('quote'); }} variant="secondary" colors={colors} compact />
              <AppButton label="✎ Nota" onPress={() => { void handleSaveAnnotation('note'); }} colors={colors} compact disabled={!noteDraft.trim()} />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Buscar en el libro (sin distinguir tildes ni mayúsculas). */}
      <Modal visible={isSearchVisible} transparent animationType="fade" onRequestClose={() => setIsSearchVisible(false)}>
        <TouchableOpacity style={[styles.menuBackdrop, styles.topBackdrop]} activeOpacity={1} onPress={() => setIsSearchVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.menuSheet, styles.topSheet, styles.searchSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.inlineActions}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleRunSearch}
                placeholder="Buscar en el libro"
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                autoFocus
                style={[styles.searchInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
              />
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
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
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
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
        title="Temporizador de sueno"
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
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 4 },
  controlPanel: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8 },
  modeToggle: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  modeToggleText: { fontSize: 13, fontWeight: '700' },
  // Indicador de avance flotante, casi transparente: informa sin molestar.
  // Autocontenido (oscuro + blanco): no se pierde sobre páginas blancas.
  readOverlay: {
    position: 'absolute',
    top: 8,
    right: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(20,20,20,0.5)',
  },
  readOverlayText: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
  audioBar: { position: 'absolute', left: 12, right: 86, bottom: 12, alignItems: 'center', gap: 6 },
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
    bottom: 80,
    right: 14,
    backgroundColor: 'rgba(20,20,20,0.65)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  audioPageChipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet: { borderTopWidth: 1, borderRadius: 20, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 8 },
  menuHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', marginBottom: 6 },
  headerMenuButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginRight: 4 },
  headerMenuLabel: { fontSize: 14, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  annotationExcerpt: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  annotationInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  topBackdrop: { justifyContent: 'flex-start', paddingTop: 56, paddingHorizontal: 12 },
  topSheet: { borderWidth: 1, borderRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, paddingTop: 16, paddingBottom: 16 },
  // Media pantalla como mucho: la otra mitad es del teclado.
  searchSheet: { maxHeight: '48%' },
  searchInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
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
    gap: 8,
    backgroundColor: 'rgba(20,20,20,0.6)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  audioBarMain: { minWidth: 128 },
  audioBarGhostLabel: { color: '#ffffff' },
  audioBarError: {
    color: '#ffffff',
    backgroundColor: 'rgba(160,40,30,0.9)',
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
  pageScrubberLabel: { fontSize: 12, fontWeight: '700', minWidth: 64 },
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
  errorCard: { width: '100%', borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  errorTitle: { fontSize: 20, fontWeight: '700' },
  errorMessage: { fontSize: 15, lineHeight: 22 },
});
