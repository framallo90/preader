import Slider from '@react-native-community/slider';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { ReaderBlockCard } from '../src/components/ReaderBlockCard';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { useReaderController } from '../src/hooks/useReaderController';
import { DocumentParseError, getFriendlyParseErrorMessage } from '../src/services/documentParser';
import { getParserForDocument } from '../src/services/parserRegistry';
import { SpeechVoice, speechService } from '../src/services/speechService';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { progressRepository } from '../src/storage/progressRepository';
import { recentFilesRepository } from '../src/storage/recentFilesRepository';
import { ParsedDocument, TextBlock } from '../src/types/document';
import { ReadingProgress, StoredDocument } from '../src/types/storage';
import { clampRounded } from '../src/utils/math';
import { ThemeColors } from '../src/utils/theme';

const SYSTEM_VOICE_VALUE = '__system__';
const KEEP_AWAKE_TAG = 'reader-screen';
const MIN_RATE = 0.6;
const MAX_RATE = 1.6;

type StatusTone = 'primary' | 'neutral' | 'warning' | 'danger';

function formatRateLabel(rate: number) {
  return `${rate.toFixed(2)}x`;
}

function sortVoices(voices: SpeechVoice[]) {
  const scoreLanguage = (language: string) => {
    if (language.startsWith('es')) {
      return 0;
    }

    if (language.startsWith('en')) {
      return 1;
    }

    return 2;
  };

  return [...voices].sort((left, right) => {
    const languageScore = scoreLanguage(left.language) - scoreLanguage(right.language);

    if (languageScore !== 0) {
      return languageScore;
    }

    return left.name.localeCompare(right.name);
  });
}

function formatRemainingTime(deadlineAt: number | null, now: number) {
  if (!deadlineAt) {
    return 'Sin temporizador';
  }

  const remainingMs = Math.max(0, deadlineAt - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `Dormir en ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getStatusColors(colors: ThemeColors, tone: StatusTone) {
  if (tone === 'primary') {
    return {
      backgroundColor: colors.accent,
      borderColor: colors.primary,
      textColor: colors.text,
    };
  }

  if (tone === 'warning') {
    return {
      backgroundColor: colors.highlight,
      borderColor: colors.highlight,
      textColor: colors.highlightText,
    };
  }

  if (tone === 'danger') {
    return {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.danger,
      textColor: colors.danger,
    };
  }

  return {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    textColor: colors.textMuted,
  };
}

export default function ReaderScreen() {
  const { documentId } = useLocalSearchParams<{ documentId?: string }>();
  const { colors, settings, updateSettings } = useAppSettings();
  const [documentRecord, setDocumentRecord] = useState<StoredDocument | null>(null);
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [savedProgress, setSavedProgress] = useState<ReadingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [isSleepTimerPickerVisible, setIsSleepTimerPickerVisible] = useState(false);
  const [areSecondaryControlsVisible, setAreSecondaryControlsVisible] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepDeadlineAt, setSleepDeadlineAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [isUsingCachedText, setIsUsingCachedText] = useState(false);
  const listRef = useRef<FlatList<TextBlock>>(null);

  useEffect(() => {
    let isMounted = true;

    void speechService
      .getVoices()
      .then((availableVoices) => {
        if (isMounted) {
          setVoices(sortVoices(availableVoices));
        }
      })
      .catch((error) => {
        if (isMounted) {
          setSpeechError(
            error instanceof Error
              ? error.message
              : 'No se pudieron leer las voces disponibles del motor TTS.',
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setVoicesLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadDocument = async () => {
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
        const [storedDocument, progress] = await Promise.all([
          recentFilesRepository.getDocumentById(documentId),
          progressRepository.getProgress(documentId),
        ]);

        if (!storedDocument) {
          throw new DocumentParseError(
            'missing_file',
            'El documento ya no figura en la base local de recientes.',
          );
        }

        await recentFilesRepository.touchDocument(storedDocument.id);

        const cachedParsed = await parsedDocumentRepository.getParsedDocument(storedDocument);

        if (!isMounted) {
          return;
        }

        if (cachedParsed) {
          setDocumentRecord(storedDocument);
          setSavedProgress(progress);
          setParsedDocument(cachedParsed);
          setIsUsingCachedText(true);
          return;
        }

        const parser = getParserForDocument(storedDocument.type, storedDocument.name);
        const parsed = await parser.parse(storedDocument.uri);

        await parsedDocumentRepository.saveParsedDocument(storedDocument, parsed);

        if (!isMounted) {
          return;
        }

        setDocumentRecord(storedDocument);
        setSavedProgress(progress);
        setParsedDocument({
          ...parsed,
          id: storedDocument.id,
          fileName: storedDocument.name,
          sourceUri: storedDocument.uri,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setParseError(getFriendlyParseErrorMessage(error));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadDocument();

    return () => {
      isMounted = false;
    };
  }, [documentId]);

  const persistProgress = useCallback(
    async (snapshot: { blockIndex: number; charIndex: number; percentage: number }) => {
      if (!documentId) {
        return;
      }

      await progressRepository.saveProgress({
        documentId,
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

  useEffect(() => {
    if (!parsedDocument || parsedDocument.blocks.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: reader.currentBlockIndex,
        animated: true,
        viewPosition: 0.18,
      });
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

    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [reader.isPlaying, settings.keepScreenAwakeWhileReading]);

  useEffect(() => {
    if (!sleepDeadlineAt) {
      return;
    }

    setClockNow(Date.now());

    const interval = setInterval(() => {
      const nextNow = Date.now();
      setClockNow(nextNow);

      if (nextNow >= sleepDeadlineAt) {
        setSleepDeadlineAt(null);
        setSleepTimerMinutes(null);

        if (reader.isPlaying) {
          void reader.stop();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [reader, reader.isPlaying, sleepDeadlineAt]);

  const voiceOptions = useMemo(
    () => [
      {
        value: SYSTEM_VOICE_VALUE,
        label: 'Sistema',
        description: 'Usa la voz por defecto del dispositivo.',
      },
      ...voices.map((voice) => ({
        value: voice.identifier,
        label: voice.name,
        description: voice.language,
      })),
    ],
    [voices],
  );

  const sleepTimerOptions = useMemo(
    () => [
      {
        value: 'off',
        label: 'Sin temporizador',
        description: 'La lectura sigue hasta que la detengas.',
      },
      {
        value: '10',
        label: '10 minutos',
        description: 'Se detiene sola despues de diez minutos.',
      },
      {
        value: '20',
        label: '20 minutos',
        description: 'Se detiene sola despues de veinte minutos.',
      },
      {
        value: '30',
        label: '30 minutos',
        description: 'Se detiene sola despues de treinta minutos.',
      },
    ],
    [],
  );

  const selectedVoiceLabel = useMemo(() => {
    if (!settings.defaultVoiceId) {
      return 'Sistema';
    }

    return voices.find((voice) => voice.identifier === settings.defaultVoiceId)?.name ?? 'Sistema';
  }, [settings.defaultVoiceId, voices]);

  const sleepTimerLabel = useMemo(
    () => formatRemainingTime(sleepDeadlineAt, clockNow),
    [clockNow, sleepDeadlineAt],
  );

  const readerStatus = useMemo(() => {
    if (parseError) {
      return {
        label: parseError.includes('no contiene texto extraible') ? 'PDF sin texto' : 'Error',
        tone: 'danger' as StatusTone,
      };
    }

    if (speechError) {
      return {
        label: 'Error de voz',
        tone: 'danger' as StatusTone,
      };
    }

    if (!voicesLoaded) {
      return {
        label: 'Cargando voces',
        tone: 'neutral' as StatusTone,
      };
    }

    if (voicesLoaded && voices.length === 0) {
      return {
        label: 'Sin voces',
        tone: 'warning' as StatusTone,
      };
    }

    if (reader.isPlaying) {
      return {
        label: 'Leyendo',
        tone: 'primary' as StatusTone,
      };
    }

    return {
      label: 'Detenido',
      tone: 'neutral' as StatusTone,
    };
  }, [parseError, reader.isPlaying, speechError, voices.length, voicesLoaded]);

  const statusColors = getStatusColors(colors, readerStatus.tone);

  const handleRateChange = useCallback(
    async (delta: number) => {
      const nextRate = clampRounded(settings.defaultRate + delta, MIN_RATE, MAX_RATE);

      await updateSettings({ defaultRate: nextRate });

      if (reader.isPlaying) {
        await reader.restartFromCurrent();
      }
    },
    [reader, settings.defaultRate, updateSettings],
  );

  const handleVoiceChange = useCallback(
    async (voiceValue: string) => {
      const nextVoiceId = voiceValue === SYSTEM_VOICE_VALUE ? null : voiceValue;

      setIsVoicePickerVisible(false);
      await updateSettings({ defaultVoiceId: nextVoiceId });

      if (reader.isPlaying) {
        await reader.restartFromCurrent();
      }
    },
    [reader, updateSettings],
  );

  const handleSleepTimerChange = useCallback((optionValue: string) => {
    setIsSleepTimerPickerVisible(false);

    if (optionValue === 'off') {
      setSleepTimerMinutes(null);
      setSleepDeadlineAt(null);
      return;
    }

    const minutes = Number(optionValue);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      setSleepTimerMinutes(null);
      setSleepDeadlineAt(null);
      return;
    }

    setSleepTimerMinutes(minutes);
    setSleepDeadlineAt(Date.now() + minutes * 60 * 1000);
  }, []);

  const handleTogglePlayback = useCallback(async () => {
    if (reader.isPlaying) {
      await reader.stop();
      return;
    }

    await reader.play();
  }, [reader]);

  const handleSeekBlock = useCallback(
    async (blockIndex: number) => {
      await reader.seekToBlock(blockIndex, reader.isPlaying);
    },
    [reader],
  );

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
        <View
          style={[
            styles.errorCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: statusColors.backgroundColor,
                borderColor: statusColors.borderColor,
              },
            ]}
          >
            <Text style={[styles.statusBadgeText, { color: statusColors.textColor }]}>
              {readerStatus.label}
            </Text>
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>No se pudo abrir el documento</Text>
          <Text style={[styles.errorMessage, { color: colors.textMuted }]}>
            {parseError ?? 'El documento seleccionado no esta disponible.'}
          </Text>
          <AppButton label="Volver al inicio" onPress={() => router.replace('/')} colors={colors} />
        </View>
      </SafeAreaView>
    );
  }

  const activeBlock = parsedDocument.blocks[reader.currentBlockIndex];
  const playButtonLabel = reader.isPlaying
    ? 'Detener'
    : reader.currentCharIndex > 0 || reader.currentBlockIndex > 0
      ? 'Reanudar'
      : 'Leer';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Lector' }} />

      <View
        style={[
          styles.summaryCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
              {documentRecord.name}
            </Text>
            <Text style={[styles.summaryText, { color: colors.textMuted }]}>
              Bloque {reader.currentBlockIndex + 1} de {parsedDocument.blocks.length} ·{' '}
              {reader.progressPercentage.toFixed(1)}%
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: statusColors.backgroundColor,
                borderColor: statusColors.borderColor,
              },
            ]}
          >
            <Text style={[styles.statusBadgeText, { color: statusColors.textColor }]}>
              {readerStatus.label}
            </Text>
          </View>
        </View>

        <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${Math.max(0, Math.min(reader.progressPercentage, 100))}%`,
              },
            ]}
          />
        </View>

        {isUsingCachedText ? (
          <Text style={[styles.cacheLabel, { color: colors.textMuted }]}>
            Cache local lista para abrir mas rapido.
          </Text>
        ) : null}

        {speechError ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.warningText, { color: colors.danger }]}>{speechError}</Text>
          </View>
        ) : null}
        {voicesLoaded && voices.length === 0 ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.warningText, { color: colors.danger }]}>
              No se detectaron voces disponibles para elegir. La app intentara usar la voz por
              defecto del sistema.
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.readerStage,
          {
            backgroundColor: colors.readerSurface,
            borderColor: colors.border,
          },
        ]}
      >
        <FlatList
          style={styles.readerList}
          ref={listRef}
          data={parsedDocument.blocks}
          keyExtractor={(item) => item.index.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.18,
              });
            }, 120);
          }}
          renderItem={({ item }) => (
            <ReaderBlockCard
              block={item}
              isActive={item.index === reader.currentBlockIndex}
              colors={colors}
              fontSize={settings.fontSize}
              wordRange={item.index === reader.currentBlockIndex ? reader.currentWordRange : null}
              onPress={() => {
                void handleSeekBlock(item.index);
              }}
            />
          )}
        />
      </View>

      <View
        style={[
          styles.controlPanel,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.controlsRow}>
          <View style={styles.sideControl}>
            <AppButton
              label="Anterior"
              onPress={() => {
                void reader.previousBlock();
              }}
              variant="secondary"
              colors={colors}
              compact
              fullWidth
            />
          </View>
          <View style={styles.mainControl}>
            <AppButton
              label={playButtonLabel}
              onPress={() => {
                void handleTogglePlayback();
              }}
              colors={colors}
              compact
              fullWidth
              style={styles.playButton}
              labelStyle={styles.playButtonLabel}
            />
          </View>
          <View style={styles.sideControl}>
            <AppButton
              label="Siguiente"
              onPress={() => {
                void reader.nextBlock();
              }}
              variant="secondary"
              colors={colors}
              compact
              fullWidth
            />
          </View>
        </View>

        <View style={styles.controlsFooter}>
          {activeBlock ? (
            <Text style={[styles.resumeText, { color: colors.textMuted }]} numberOfLines={1}>
              Punto actual: bloque {activeBlock.index + 1}
              {reader.currentCharIndex > 0 ? `, caracter ${reader.currentCharIndex}` : ''}
            </Text>
          ) : (
            <View />
          )}
          <AppButton
            label={areSecondaryControlsVisible ? 'Ocultar ajustes' : 'Mas ajustes'}
            onPress={() => setAreSecondaryControlsVisible((current) => !current)}
            variant="ghost"
            colors={colors}
            compact
          />
        </View>

        {areSecondaryControlsVisible ? (
          <View style={[styles.secondaryControlsCard, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.sliderGroup}>
              <View style={styles.sliderHeader}>
                <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Salto rapido</Text>
                <Text style={[styles.sliderLabel, { color: colors.textMuted }]}>
                  Bloque {reader.currentBlockIndex + 1}
                </Text>
              </View>
              <Slider
                value={reader.currentBlockIndex}
                minimumValue={0}
                maximumValue={Math.max(parsedDocument.blocks.length - 1, 0)}
                step={1}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
                onSlidingComplete={(value) => {
                  void handleSeekBlock(Math.round(value));
                }}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Velocidad</Text>
              <View style={styles.inlineActions}>
                <AppButton
                  label="-"
                  onPress={() => {
                    void handleRateChange(-0.1);
                  }}
                  variant="ghost"
                  colors={colors}
                  compact
                />
                <Text style={[styles.inlineValue, { color: colors.text }]}>
                  {formatRateLabel(settings.defaultRate)}
                </Text>
                <AppButton
                  label="+"
                  onPress={() => {
                    void handleRateChange(0.1);
                  }}
                  variant="ghost"
                  colors={colors}
                  compact
                />
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Voz</Text>
              <AppButton
                label={selectedVoiceLabel}
                onPress={() => setIsVoicePickerVisible(true)}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textMuted }]}>Temporizador</Text>
              <AppButton
                label={sleepTimerLabel}
                onPress={() => setIsSleepTimerPickerVisible(true)}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>

            {sleepTimerMinutes ? (
              <Text style={[styles.resumeText, { color: colors.textMuted }]}>
                Temporizador activo: {sleepTimerMinutes} min
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <OptionPickerModal
        title="Elige una voz"
        visible={isVoicePickerVisible}
        colors={colors}
        selectedValue={settings.defaultVoiceId ?? SYSTEM_VOICE_VALUE}
        options={voiceOptions}
        onClose={() => setIsVoicePickerVisible(false)}
        onSelect={(value) => {
          void handleVoiceChange(value);
        }}
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
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryCopy: {
    flex: 1,
    gap: 4,
  },
  fileName: {
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 17,
  },
  cacheLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  warningText: {
    fontSize: 12,
    lineHeight: 17,
  },
  noticeBox: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  readerStage: {
    flex: 1,
    marginHorizontal: 10,
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 26,
    overflow: 'hidden',
  },
  readerList: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  controlPanel: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideControl: {
    flex: 0.9,
  },
  mainControl: {
    flex: 1.2,
  },
  playButton: {
    minHeight: 46,
    borderRadius: 18,
  },
  playButtonLabel: {
    fontSize: 15,
  },
  sliderGroup: {
    gap: 6,
  },
  controlsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  secondaryControlsCard: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sliderLabel: {
    fontSize: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inlineValue: {
    minWidth: 52,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  resumeText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  errorCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  errorMessage: {
    fontSize: 15,
    lineHeight: 22,
  },
});
