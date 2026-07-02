import Slider from '@react-native-community/slider';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { ReaderBlockCard } from '../src/components/ReaderBlockCard';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { useReaderController } from '../src/hooks/useReaderController';
import { DocumentParseError, getFriendlyParseErrorMessage } from '../src/services/documentParser';
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
  const { documentId } = useLocalSearchParams<{ documentId?: string }>();
  const { colors, settings, updateSettings } = useAppSettings();
  const [documentRecord, setDocumentRecord] = useState<Book | null>(null);
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [savedProgress, setSavedProgress] = useState<ReadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
        const parser = getParserForDocument(book.type, book.name);
        const parsed = await parser.parse(book.uri);
        const chapters = detectChapters(book.id, parsed.fullText);
        const parsedWithChapters: ParsedDocument = {
          ...parsed,
          id: book.id,
          fileName: book.name,
          sourceUri: book.uri,
          chapters,
        };
        if (chapters.length > 0) await chapterRepository.saveChaptersForBook(book.id, chapters);
        await parsedDocumentRepository.saveParsedDocument(book, parsedWithChapters);
        if (!isMounted) return;
        setDocumentRecord(book);
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
    if (shouldKeepAwake) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } else {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
    return () => { void deactivateKeepAwake(KEEP_AWAKE_TAG); };
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
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Lector' }} />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.text }]}>Abriendo el documento...</Text>
      </SafeAreaView>
    );
  }

  if (parseError || !parsedDocument || !documentRecord) {
    return (
      <SafeAreaView style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Lector' }} />
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
      <Stack.Screen options={{ title: 'Lector' }} />

      <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>{documentRecord.name}</Text>
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

      {chapterBanner && !reader.isPlaying ? (
        <TouchableOpacity
          style={[styles.chapterBanner, { backgroundColor: colors.accent, borderColor: colors.primary }]}
          onPress={() => setChapterBanner(null)}
          activeOpacity={0.85}
        >
          <View style={styles.chapterBannerHeader}>
            <Text style={[styles.chapterBannerTitle, { color: colors.text }]}>{chapterBanner.title}</Text>
            {chapterBanner.povCharacter ? (
              <View style={[styles.povBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.povBadgeText, { color: colors.background }]}>POV</Text>
              </View>
            ) : null}
          </View>
          {chapterBanner.beforeSummary ? (
            <Text style={[styles.chapterBannerBody, { color: colors.textMuted }]} numberOfLines={3}>
              {chapterBanner.beforeSummary}
            </Text>
          ) : null}
          <View style={styles.chapterBannerFooter}>
            <Text style={[styles.chapterBannerDismiss, { color: colors.textMuted }]}>Toca para cerrar</Text>
            {chapterBanner.previousChapterId && chapterBanner.beforeSummary ? (
              <TouchableOpacity onPress={() => {
                const prevId = chapterBanner.previousChapterId;
                setChapterBanner(null);
                router.push(`/chapter-context?chapterId=${prevId}`);
              }}>
                <Text style={[styles.chapterBannerLink, { color: colors.primary }]}>Ver contexto completo →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={[styles.readerStage, { backgroundColor: colors.readerSurface, borderColor: colors.border }]}>
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
      </View>

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
          {activeBlock ? (
            <Text style={[styles.resumeText, { color: colors.textMuted }]} numberOfLines={1}>
              Bloque {activeBlock.index + 1}{reader.currentCharIndex > 0 ? `, pos ${reader.currentCharIndex}` : ''}
            </Text>
          ) : <View />}
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
  readerList: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 4 },
  controlPanel: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8 },
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
