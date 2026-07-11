import Slider from '@react-native-community/slider';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { ServerBookInfo, getBookInfo, isServerConfigured, processBookOnServer } from '../src/services/bardoServerService';
import { PdfPageList, PdfPageListHandle } from '../src/components/PdfPageList';
import { buildTextBlocks } from '../src/utils/textBlocks';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../src/utils/documentProgress';
import { charForPage, pageForChar } from '../src/utils/pageMap';
import { getDisplayTitle } from '../src/utils/bookDisplay';
import { extractChapterContext } from '../src/services/claudeService';
import { getParserForDocument } from '../src/services/parserRegistry';
import { bookRepository } from '../src/storage/bookRepository';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { characterRepository } from '../src/storage/characterRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { chapterContextRepository } from '../src/storage/chapterContextRepository';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';
import { Book, ReadingProgress } from '../src/types/storage';
import { ParsedDocument, TextBlock } from '../src/types/document';
import { detectChapters } from '../src/utils/chapterDetector';
import { clampRounded } from '../src/utils/math';
import { ThemeColors } from '../src/utils/theme';

const KEEP_AWAKE_TAG = 'reader-screen';
const MIN_RATE = 0.6;
const MAX_RATE = 1.6;

const OPENAI_VOICE_OPTIONS = [
  { value: 'onyx', label: 'Onyx', description: 'Voz masculina profunda y narrativa (por defecto).' },
  { value: 'nova', label: 'Nova', description: 'Voz femenina clara y energica.' },
  { value: 'alloy', label: 'Alloy', description: 'Voz neutra y versatil.' },
  { value: 'echo', label: 'Echo', description: 'Voz masculina expresiva.' },
  { value: 'fable', label: 'Fable', description: 'Voz masculina calida y dramatica.' },
  { value: 'shimmer', label: 'Shimmer', description: 'Voz femenina suave.' },
];
const VALID_OPENAI_VOICES = new Set(OPENAI_VOICE_OPTIONS.map((v) => v.value));

type StatusTone = 'primary' | 'neutral' | 'warning' | 'danger';

type ChapterBanner = {
  chapterId: string;
  previousChapterId: string | null;
  title: string;
  povCharacter: string | null;
  beforeSummary: string | null;
};

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
  const [documentRecord, setDocumentRecord] = useState<Book | null>(null);
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [savedProgress, setSavedProgress] = useState<ReadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Abriendo el documento…');
  // Dos experiencias sobre la MISMA posición: leer (texto limpio, sin chrome de
  // audio) o escuchar (reproductor). Si ya hay audio sonando de este libro, se
  // entra directo en modo audio.
  // Vista única: SIEMPRE se lee (páginas del PDF o texto) y el audio se
  // controla con la barra flotante. La vieja "pantalla de escucha" murió:
  // escuchar mientras ves el libro real es mejor. viewMode queda fijo.
  const viewMode = 'read' as 'read' | 'listen';
  // Modo lectura visual (páginas reales del PDF renderizadas por el server).
  const [serverPageInfo, setServerPageInfo] = useState<ServerBookInfo | null>(null);
  const [pdfPageForUi, setPdfPageForUi] = useState(0);
  // Pantalla completa en modo lectura: tocás la página y desaparece el chrome.
  const [isImmersive, setIsImmersive] = useState(false);
  const currentPdfPageRef = useRef(0);
  const pdfListRef = useRef<PdfPageListHandle>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [isSleepTimerPickerVisible, setIsSleepTimerPickerVisible] = useState(false);
  const [areSecondaryControlsVisible, setAreSecondaryControlsVisible] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepDeadlineAt, setSleepDeadlineAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [isUsingCachedText, setIsUsingCachedText] = useState(false);
  const [chapterBanner, setChapterBanner] = useState<ChapterBanner | null>(null);
  const listRef = useRef<FlatList<TextBlock>>(null);
  const prevChapterIdRef = useRef<string | null>(null);
  const extractedChaptersRef = useRef<Set<string>>(new Set());

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
        const cachedParsed = await parsedDocumentRepository.getParsedDocument(book);
        if (!isMounted) return;
        if (cachedParsed) {
          const chapters = detectChapters(book.id, cachedParsed.fullText);
          const parsedWithChapters = { ...cachedParsed, chapters };
          if (chapters.length > 0) void chapterRepository.saveChaptersForBook(book.id, chapters);
          setDocumentRecord(book);
          setSavedProgress(progress);
          setParsedDocument(parsedWithChapters);
          setIsUsingCachedText(true);
          return;
        }
        // Camino preferido: procesar en el server propio (bardo-api). El server
        // extrae y limpia MUCHO mejor y más rápido que el teléfono, y habilita
        // libros gigantes que localmente harían OOM. Si falla, fallback local.
        if (isServerConfigured()) {
          try {
            const serverResult = await processBookOnServer(book.uri, book.name, book.type, book.id, (label) => {
              if (isMounted) setLoadingStatus(label);
            });
            const blocks = buildTextBlocks(serverResult.fullText);
            if (blocks.length > 0) {
              const chapters = detectChapters(book.id, serverResult.fullText);
              const parsedFromServer: ParsedDocument = {
                id: book.id,
                fileName: book.name,
                sourceUri: book.uri,
                fullText: serverResult.fullText,
                blocks,
                chapters,
              };
              if (chapters.length > 0) await chapterRepository.saveChaptersForBook(book.id, chapters);
              await parsedDocumentRepository.saveParsedDocument(book, parsedFromServer);
              if (!isMounted) return;
              setDocumentRecord(book);
              setSavedProgress(progress);
              setParsedDocument(parsedFromServer);
              return;
            }
          } catch {
            // Server caído, sin red o formato no soportado: se procesa local.
            if (isMounted) setLoadingStatus('Servidor no disponible, procesando en el teléfono…');
          }
        }

        // Libros descubiertos por escaneo (content://): el extractor PDF
        // nativo necesita file://, así que se materializa una copia local
        // la primera vez y se actualiza la URI del libro.
        let effectiveBook = book;
        const isPdf = book.type === 'application/pdf' || /\.pdf$/i.test(book.name);
        if (book.uri.startsWith('content://') && isPdf) {
          const localUri = await ensureLocalPdfCopy(book.id, book.uri);
          effectiveBook = { ...book, uri: localUri };
          await bookRepository.saveBook(effectiveBook);
        }
        const parser = getParserForDocument(effectiveBook.type, effectiveBook.name);
        const parsed = await parser.parse(effectiveBook.uri);
        const chapters = detectChapters(book.id, parsed.fullText);
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
        if (!isMounted) return;
        setDocumentRecord(effectiveBook);
        setSavedProgress(progress);
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

  const effectiveVoiceId = useMemo(() => {
    const saved = settings.defaultVoiceId;
    return saved && VALID_OPENAI_VOICES.has(saved) ? saved : 'onyx';
  }, [settings.defaultVoiceId]);

  const reader = useReaderController({
    document: parsedDocument,
    initialBlockIndex: savedProgress?.blockIndex ?? 0,
    initialCharIndex: savedProgress?.charIndex ?? 0,
    rate: settings.defaultRate,
    voiceId: effectiveVoiceId,
    onError: setSpeechError,
    onProgressChange: persistProgress,
  });

  // Detiene y descarga el audio (cierra lo que se está escuchando).
  const handleStop = useCallback(async () => {
    await documentAudioPlaybackService.stopAndUnload();
  }, []);

  // Estable (prop del visor memoizado): alterna pantalla completa.
  const handleToggleImmersive = useCallback(() => {
    setIsImmersive((v) => !v);
  }, []);

  // Si es un PDF procesado por el server, hay lector visual de páginas.
  useEffect(() => {
    if (!documentRecord || !parsedDocument) return;
    const isPdf = documentRecord.type === 'application/pdf' || /\.pdf$/i.test(documentRecord.name);
    if (!isPdf) {
      setServerPageInfo(null);
      return;
    }
    let mounted = true;
    void getBookInfo(documentRecord.id).then((info) => {
      if (mounted) setServerPageInfo(info);
    });
    return () => { mounted = false; };
  }, [documentRecord, parsedDocument]);

  // "Escuchar" desde el Home: arranca la voz solo (una vez, al estar cargado).
  const autoListenRef = useRef(false);
  useEffect(() => {
    if (mode !== 'listen' || autoListenRef.current || !parsedDocument || isLoading) return;
    autoListenRef.current = true;
    void reader.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, parsedDocument, isLoading]);

  // Página inicial: donde quedó la lectura. Con pageOffsets el mapeo es exacto;
  // sin ellos (paquete viejo) cae al proporcional.
  const initialPdfPage = useMemo(() => {
    if (!serverPageInfo || serverPageInfo.pages <= 0) return 0;
    if (serverPageInfo.pageOffsets && parsedDocument) {
      const abs = getAbsoluteCharIndex(
        parsedDocument,
        savedProgress?.blockIndex ?? 0,
        savedProgress?.charIndex ?? 0,
      );
      return pageForChar(abs, serverPageInfo.pageOffsets);
    }
    const pct = savedProgress?.percentage ?? 0;
    const page = Math.floor((pct / 100) * serverPageInfo.pages);
    return Math.min(serverPageInfo.pages - 1, Math.max(0, page));
  }, [serverPageInfo, savedProgress, parsedDocument]);

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
      if (!parsedDocument || !serverPageInfo || serverPageInfo.pages <= 0) return;
      const abs = serverPageInfo.pageOffsets
        ? charForPage(pageIndex, serverPageInfo.pageOffsets, parsedDocument.fullText.length)
        : Math.round(((pageIndex + 0.5) / serverPageInfo.pages) * parsedDocument.fullText.length);
      const pos = getPositionFromAbsoluteChar(parsedDocument, abs);
      void reader.syncPosition(pos.blockIndex, pos.charIndex);
    },
    [parsedDocument, serverPageInfo, reader.syncPosition],
  );

  const currentAbsoluteChar = useMemo(() => {
    if (!parsedDocument) return 0;
    const block = parsedDocument.blocks[reader.currentBlockIndex];
    return block ? block.startChar + reader.currentCharIndex : 0;
  }, [parsedDocument, reader.currentBlockIndex, reader.currentCharIndex]);

  const currentChapter = useMemo(() => {
    if (!parsedDocument?.chapters?.length) return null;
    return (
      parsedDocument.chapters.find(
        (ch) => ch.startChar <= currentAbsoluteChar && currentAbsoluteChar < ch.endChar,
      ) ?? parsedDocument.chapters[parsedDocument.chapters.length - 1]
    );
  }, [parsedDocument, currentAbsoluteChar]);

  // Página por donde va la VOZ (para marcarla y seguirla mientras suena).
  // Adelanto (~4 s de habla): la posición interpolada del audio corre unos
  // segundos DETRÁS de la voz real (pausas + silencios del WAV), así que sin
  // esto la hoja pasaba tarde. Con el adelanto, pasa apenas la voz llega.
  const AUDIO_PAGE_LOOKAHEAD_CHARS = 80;

  const audioPage = useMemo(() => {
    if (!serverPageInfo || serverPageInfo.pages <= 0) return null;
    if (!parsedDocument || parsedDocument.fullText.length === 0) return null;
    const biased = Math.min(parsedDocument.fullText.length, currentAbsoluteChar + AUDIO_PAGE_LOOKAHEAD_CHARS);
    if (serverPageInfo.pageOffsets) {
      return pageForChar(biased, serverPageInfo.pageOffsets);
    }
    const page = Math.floor((biased / parsedDocument.fullText.length) * serverPageInfo.pages);
    return Math.min(serverPageInfo.pages - 1, Math.max(0, page));
  }, [serverPageInfo, parsedDocument, currentAbsoluteChar]);

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
    if (!currentChapter || !parsedDocument || !documentRecord) return;
    const currentChapterId = currentChapter.id;
    const previousChapterId = prevChapterIdRef.current;
    if (currentChapterId === previousChapterId) return;
    prevChapterIdRef.current = currentChapterId;

    const prevChapter = parsedDocument.chapters.find(
      (ch) => ch.orderIndex === currentChapter.orderIndex - 1,
    );
    if (prevChapter) {
      void chapterContextRepository.getContextForChapter(prevChapter.id).then((context) => {
        setChapterBanner({
          chapterId: currentChapterId,
          previousChapterId: prevChapter.id,
          title: currentChapter.title,
          povCharacter: currentChapter.povCharacter,
          beforeSummary: context?.afterSummary ?? null,
        });
      });
    } else {
      setChapterBanner({
        chapterId: currentChapterId,
        previousChapterId: null,
        title: currentChapter.title,
        povCharacter: currentChapter.povCharacter,
        beforeSummary: null,
      });
    }

    if (previousChapterId && !extractedChaptersRef.current.has(previousChapterId)) {
      extractedChaptersRef.current.add(previousChapterId);
      void (async () => {
        try {
          const existing = await chapterContextRepository.getContextForChapter(previousChapterId);
          if (existing?.afterSummary) {
            setChapterBanner((prev) => {
              if (prev?.chapterId === currentChapterId && !prev.beforeSummary) {
                return { ...prev, beforeSummary: existing.afterSummary };
              }
              return prev;
            });
            return;
          }
          const prevChapterData = parsedDocument.chapters.find((ch) => ch.id === previousChapterId);
          if (!prevChapterData) return;
          const chapterText = parsedDocument.fullText.slice(
            prevChapterData.startChar,
            Math.min(prevChapterData.endChar, prevChapterData.startChar + 16_000),
          );
          const prevSummary = await chapterContextRepository.getPreviousChapterSummary(
            documentRecord.id,
            prevChapterData.orderIndex,
          );
          const result = await extractChapterContext(chapterText, prevSummary, prevChapterData.title);
          await chapterContextRepository.saveContext({
            chapterId: previousChapterId,
            beforeSummary: result.beforeSummary,
            afterSummary: result.afterSummary,
            characters: result.characters,
            keyEvents: result.keyEvents,
            extractedAt: new Date().toISOString(),
          });
          const now = new Date().toISOString();
          for (const name of result.characters) {
            const characterId = [documentRecord.sagaId ?? 'global', name]
              .join('--')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/-+/g, '-');
            await characterRepository.upsertCharacter({
              id: characterId,
              sagaId: documentRecord.sagaId,
              name,
              aliases: [],
              house: null,
              description: null,
              firstSeenBookId: documentRecord.id,
              firstSeenChapterId: previousChapterId,
              updatedAt: now,
            });
          }
          setChapterBanner((prev) => {
            if (prev?.chapterId === currentChapterId && !prev.beforeSummary) {
              return { ...prev, beforeSummary: result.afterSummary };
            }
            return prev;
          });
        } catch {
          extractedChaptersRef.current.delete(previousChapterId);
        }
      })();
    }
  }, [currentChapter, parsedDocument, documentRecord]);

  useEffect(() => {
    if (!parsedDocument || parsedDocument.blocks.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: reader.currentBlockIndex, animated: true, viewPosition: 0.18 });
    }, 80);
    return () => clearTimeout(timer);
  }, [parsedDocument, reader.currentBlockIndex]);

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

  useEffect(() => {
    if (!sleepDeadlineAt) return;
    setClockNow(Date.now());
    const interval = setInterval(() => {
      const nextNow = Date.now();
      setClockNow(nextNow);
      if (nextNow >= sleepDeadlineAt) {
        setSleepDeadlineAt(null);
        setSleepTimerMinutes(null);
        if (reader.isPlaying) void reader.stop();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [reader, reader.isPlaying, sleepDeadlineAt]);

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

  const selectedVoiceLabel = useMemo(
    () => OPENAI_VOICE_OPTIONS.find((v) => v.value === effectiveVoiceId)?.label ?? 'Onyx',
    [effectiveVoiceId],
  );

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

  const handleVoiceChange = useCallback(
    async (voiceValue: string) => {
      setIsVoicePickerVisible(false);
      await updateSettings({ defaultVoiceId: voiceValue });
      if (reader.isPlaying) await reader.restartFromCurrent();
    },
    [reader, updateSettings],
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

  const activeBlock = parsedDocument.blocks[reader.currentBlockIndex];
  const playButtonLabel = reader.isPlaying ? 'Pausar' : reader.isPreparing ? 'Preparando...' : reader.currentCharIndex > 0 || reader.currentBlockIndex > 0 ? 'Reanudar' : 'Escuchar';
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
        }}
      />

      {viewMode === 'listen' ? (
      <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>{documentRecord.title ?? documentRecord.name}</Text>
            {currentChapter ? (
              <Text style={[styles.chapterTitle, { color: colors.primary }]} numberOfLines={1}>{currentChapter.title}</Text>
            ) : null}
            <Text style={[styles.summaryText, { color: colors.textMuted }]}>
              Bloque {reader.currentBlockIndex + 1} de {parsedDocument.blocks.length} — {reader.progressPercentage.toFixed(1)}%
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColors.backgroundColor, borderColor: statusColors.borderColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusColors.textColor }]}>{readerStatus.label}</Text>
          </View>
        </View>

        <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.max(0, Math.min(reader.progressPercentage, 100))}%` }]} />
        </View>

        {isUsingCachedText ? <Text style={[styles.cacheLabel, { color: colors.textMuted }]}>Cache local lista para abrir mas rapido.</Text> : null}

        {reader.isPreparing ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.warningText, { color: colors.text }]}>
              Preparando audio local por tramos para una reproduccion mas estable.
            </Text>
            <View style={[styles.preparingTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.preparingFill, { backgroundColor: colors.primary, width: `${Math.max(6, Math.min(reader.preparationProgress * 100, 100))}%` }]} />
            </View>
            <Text style={[styles.cacheLabel, { color: colors.textMuted }]}>{Math.round(reader.preparationProgress * 100)}% listo</Text>
          </View>
        ) : null}

        {speechError ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.warningText, { color: colors.danger }]}>{speechError}</Text>
          </View>
        ) : null}
      </View>
      ) : null}

      {/* El recap de capítulo ya no aparece solo (era invasivo y se cerraba con
          cualquier toque): ahora vive a demanda en "Más ajustes → Contexto". La
          extracción en background sigue igual (alimenta la wiki y el chat). */}

      <View
        style={[
          styles.readerStage,
          { backgroundColor: colors.readerSurface, borderColor: colors.border },
          viewMode === 'read' && isImmersive ? styles.readerStageImmersive : null,
        ]}
      >
        {viewMode === 'read' && serverPageInfo ? (
          <PdfPageList
            ref={pdfListRef}
            bookId={documentRecord.id}
            pageCount={serverPageInfo.pages}
            pageAspect={serverPageInfo.pageAspect}
            initialPage={initialPdfPage}
            colors={colors}
            onPageChange={handlePdfPageChange}
            onTap={handleToggleImmersive}
            speakingPage={reader.isPlaying ? audioPage : null}
          />
        ) : (
        <FlatList
          style={styles.readerList}
          ref={listRef}
          data={parsedDocument.blocks}
          keyExtractor={(item) => item.index.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.18 });
            }, 120);
          }}
          renderItem={({ item }) => (
            <ReaderBlockCard
              block={item}
              isActive={item.index === reader.currentBlockIndex}
              colors={colors}
              fontSize={settings.fontSize}
              wordRange={item.index === reader.currentBlockIndex ? reader.currentWordRange : null}
              onPress={() => { void handleSeekBlock(item.index); }}
            />
          )}
        />
        )}
        {viewMode === 'read' && serverPageInfo && serverPageInfo.pages > 0 && !isImmersive ? (
          // Scrubber semi-transparente: aparece con el chrome (tap) y permite
          // saltar páginas viendo la numeración.
          <View style={[styles.pageScrubber, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pageScrubberLabel, { color: colors.text }]}>
              {pdfPageForUi + 1} / {serverPageInfo.pages}
            </Text>
            <Slider
              style={styles.pageScrubberSlider}
              minimumValue={0}
              maximumValue={Math.max(serverPageInfo.pages - 1, 0)}
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
        {viewMode === 'read' && (isImmersive || !serverPageInfo) ? (
          <View pointerEvents="none" style={styles.readOverlay}>
            <Text style={styles.readOverlayText}>
              {serverPageInfo && serverPageInfo.pages > 0
                ? `${Math.round(((pdfPageForUi + 1) / serverPageInfo.pages) * 100)}% · pág. ${pdfPageForUi + 1}/${serverPageInfo.pages}`
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
        {!isImmersive || reader.isPlaying || reader.isPreparing ? (
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

        {/* Play grande, SIEMPRE visible (el viejo "Escuchar", ahora flotante). */}
        <TouchableOpacity
          style={[styles.playFab, { backgroundColor: colors.primary }]}
          onPress={() => { void handleTogglePlayback(); }}
          disabled={reader.isPreparing}
          activeOpacity={0.8}
        >
          <Text style={styles.playFabIcon}>
            {reader.isPlaying ? '❚❚' : reader.isPreparing ? '…' : '▶'}
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'listen' ? (
      <View style={[styles.controlPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.controlsRow}>
          <View style={styles.sideControl}>
            <AppButton label="Anterior" onPress={() => { void reader.previousBlock(); }} variant="secondary" colors={colors} compact fullWidth disabled={reader.isPreparing} />
          </View>
          <View style={styles.mainControl}>
            <AppButton
              label={playButtonLabel}
              onPress={() => { void handleTogglePlayback(); }}
              colors={colors}
              compact
              fullWidth
              style={styles.playButton}
              labelStyle={styles.playButtonLabel}
              disabled={reader.isPreparing}
            />
          </View>
          <View style={styles.sideControl}>
            <AppButton label="Siguiente" onPress={() => { void reader.nextBlock(); }} variant="secondary" colors={colors} compact fullWidth disabled={reader.isPreparing} />
          </View>
        </View>

        <View style={styles.controlsFooter}>
          <AppButton
            label="Detener"
            onPress={() => { void handleStop(); }}
            variant="ghost"
            colors={colors}
            compact
          />
          <AppButton
            label="↩ 30 s"
            onPress={() => { void documentAudioPlaybackService.rewindBy(30); }}
            variant="secondary"
            colors={colors}
            compact
          />
          <AppButton
            label={areSecondaryControlsVisible ? 'Ocultar ajustes' : 'Mas ajustes'}
            onPress={() => setAreSecondaryControlsVisible((c) => !c)}
            variant="ghost"
            colors={colors}
            compact
          />
        </View>

        {areSecondaryControlsVisible ? (
          <View style={[styles.secondaryControlsCard, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Asistente</Text>
              <AppButton
                label="Abrir chat"
                onPress={() => { router.push(`/chat?bookId=${documentRecord.id}`); }}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            {currentChapter && (parsedDocument.chapters?.length ?? 0) > 0 ? (
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Contexto</Text>
                <AppButton
                  label="¿Qué pasó antes?"
                  onPress={() => {
                    const prev = parsedDocument.chapters?.find(
                      (ch) => ch.orderIndex === currentChapter.orderIndex - 1,
                    );
                    if (prev) router.push(`/chapter-context?chapterId=${prev.id}`);
                  }}
                  variant="secondary"
                  colors={colors}
                  compact
                  disabled={currentChapter.orderIndex === 0}
                />
              </View>
            ) : null}

            {hasChapters ? (
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Capitulo</Text>
                <View style={styles.inlineActions}>
                  <AppButton label="← Cap." onPress={handlePreviousChapter} variant="ghost" colors={colors} compact disabled={!hasPreviousChapter || reader.isPreparing} />
                  <Text style={[styles.inlineValue, { color: colors.text, fontSize: 12 }]} numberOfLines={1}>
                    {currentChapter ? `${currentChapter.orderIndex + 1}/${parsedDocument.chapters?.length ?? 0}` : '—'}
                  </Text>
                  <AppButton label="Cap. →" onPress={handleNextChapter} variant="ghost" colors={colors} compact disabled={!hasNextChapter || reader.isPreparing} />
                </View>
              </View>
            ) : null}

            <View style={styles.sliderGroup}>
              <View style={styles.sliderHeader}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Salto rapido</Text>
                <Text style={[styles.sliderLabel, { color: colors.textMuted }]}>Bloque {reader.currentBlockIndex + 1}</Text>
              </View>
              <Slider
                value={reader.currentBlockIndex}
                minimumValue={0}
                maximumValue={Math.max(parsedDocument.blocks.length - 1, 0)}
                step={1}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
                disabled={reader.isPreparing}
                onSlidingComplete={(value) => { void handleSeekBlock(Math.round(value)); }}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Velocidad</Text>
              <View style={styles.inlineActions}>
                <AppButton label="-" onPress={() => { void handleRateChange(-0.1); }} variant="ghost" colors={colors} compact disabled={reader.isPreparing} />
                <Text style={[styles.inlineValue, { color: colors.text }]}>{formatRateLabel(settings.defaultRate)}</Text>
                <AppButton label="+" onPress={() => { void handleRateChange(0.1); }} variant="ghost" colors={colors} compact disabled={reader.isPreparing} />
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Voz</Text>
              <AppButton label={selectedVoiceLabel} onPress={() => setIsVoicePickerVisible(true)} variant="secondary" colors={colors} compact disabled={reader.isPreparing} />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Temporizador</Text>
              <AppButton label={sleepTimerLabel} onPress={() => setIsSleepTimerPickerVisible(true)} variant="secondary" colors={colors} compact disabled={reader.isPreparing} />
            </View>

            {sleepTimerMinutes ? (
              <Text style={[styles.resumeText, { color: colors.textMuted }]}>Temporizador activo: {sleepTimerMinutes} min</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      ) : null}

      <OptionPickerModal
        title="Elige una voz"
        visible={isVoicePickerVisible}
        colors={colors}
        selectedValue={effectiveVoiceId}
        options={OPENAI_VOICE_OPTIONS}
        onClose={() => setIsVoicePickerVisible(false)}
        onSelect={(value) => { void handleVoiceChange(value); }}
      />
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
  chapterBanner: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 16, marginTop: 8, gap: 6 },
  chapterBannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chapterBannerTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  povBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  povBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  chapterBannerBody: { fontSize: 13, lineHeight: 19 },
  chapterBannerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  chapterBannerDismiss: { fontSize: 11 },
  chapterBannerLink: { fontSize: 12, fontWeight: '600' },
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
