import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { speechService } from '../services/speechService';
import { ParsedDocument, TextBlock } from '../types/document';
import { clamp } from '../utils/math';
import { WordRange, getWordRangeAt } from '../utils/wordRange';

type ProgressSnapshot = {
  blockIndex: number;
  charIndex: number;
  percentage: number;
};

type UseReaderControllerParams = {
  document: ParsedDocument | null;
  initialBlockIndex: number;
  initialCharIndex: number;
  rate: number;
  voiceId: string | null;
  onProgressChange?: (snapshot: ProgressSnapshot) => Promise<void> | void;
  onError?: (message: string) => void;
};

function getSafePosition(document: ParsedDocument | null, blockIndex: number, charIndex: number) {
  if (!document || document.blocks.length === 0) {
    return { blockIndex: 0, charIndex: 0 };
  }

  const safeBlockIndex = clamp(blockIndex, 0, document.blocks.length - 1);
  const activeBlock = document.blocks[safeBlockIndex];
  const safeCharIndex = clamp(charIndex, 0, activeBlock.text.length);

  return { blockIndex: safeBlockIndex, charIndex: safeCharIndex };
}

function calculatePercentage(document: ParsedDocument | null, blockIndex: number, charIndex: number) {
  if (!document || document.fullText.length === 0) {
    return 0;
  }

  const block = document.blocks[blockIndex];

  if (!block) {
    return 0;
  }

  const absoluteIndex = clamp(block.startChar + charIndex, 0, document.fullText.length);
  return Number(((absoluteIndex / document.fullText.length) * 100).toFixed(2));
}

export function useReaderController({
  document,
  initialBlockIndex,
  initialCharIndex,
  rate,
  voiceId,
  onProgressChange,
  onError,
}: UseReaderControllerParams) {
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [currentWordRange, setCurrentWordRange] = useState<WordRange>(null);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const documentRef = useRef<ParsedDocument | null>(document);
  const positionRef = useRef({ blockIndex: 0, charIndex: 0 });
  const rateRef = useRef(rate);
  const voiceIdRef = useRef(voiceId);
  const onProgressChangeRef = useRef(onProgressChange);
  const onErrorRef = useRef(onError);
  const shouldKeepPlayingRef = useRef(false);
  const lastPersistedAtRef = useRef(0);
  const persistPositionRef = useRef<
    ((blockIndex: number, charIndex: number, force?: boolean) => Promise<void>) | null
  >(null);
  const speakFromPositionRef = useRef<
    ((blockIndex?: number, charIndex?: number) => Promise<void>) | null
  >(null);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const reportError = useCallback((error: unknown, fallback: string) => {
    shouldKeepPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentWordRange(null);

    if (error instanceof Error && error.message.trim()) {
      onErrorRef.current?.(error.message);
      return;
    }

    onErrorRef.current?.(fallback);
  }, []);

  persistPositionRef.current = async (blockIndex: number, charIndex: number, force = false) => {
    const activeDocument = documentRef.current;
    const nextPosition = getSafePosition(activeDocument, blockIndex, charIndex);
    const percentage = calculatePercentage(
      activeDocument,
      nextPosition.blockIndex,
      nextPosition.charIndex,
    );

    positionRef.current = nextPosition;
    setCurrentBlockIndex(nextPosition.blockIndex);
    setCurrentCharIndex(nextPosition.charIndex);
    setProgressPercentage(percentage);

    const shouldPersist = force || Date.now() - lastPersistedAtRef.current > 600;

    if (shouldPersist) {
      lastPersistedAtRef.current = Date.now();
      await onProgressChangeRef.current?.({
        blockIndex: nextPosition.blockIndex,
        charIndex: nextPosition.charIndex,
        percentage,
      });
    }
  };

  speakFromPositionRef.current = async (requestedBlockIndex, requestedCharIndex) => {
    try {
      const activeDocument = documentRef.current;

      if (!activeDocument || activeDocument.blocks.length === 0) {
        return;
      }

      const nextPosition = getSafePosition(
        activeDocument,
        requestedBlockIndex ?? positionRef.current.blockIndex,
        requestedCharIndex ?? positionRef.current.charIndex,
      );
      const activeBlock: TextBlock = activeDocument.blocks[nextPosition.blockIndex];
      const remainingText = activeBlock.text.slice(nextPosition.charIndex);

      if (!remainingText.trim()) {
        if (nextPosition.blockIndex >= activeDocument.blocks.length - 1) {
          shouldKeepPlayingRef.current = false;
          setIsPlaying(false);
          setCurrentWordRange(null);
          await persistPositionRef.current?.(nextPosition.blockIndex, activeBlock.text.length, true);
          return;
        }

        await persistPositionRef.current?.(nextPosition.blockIndex + 1, 0, true);

        if (shouldKeepPlayingRef.current) {
          await speakFromPositionRef.current?.(nextPosition.blockIndex + 1, 0);
        }

        return;
      }

      await persistPositionRef.current?.(nextPosition.blockIndex, nextPosition.charIndex, true);
      setCurrentWordRange(null);

      await speechService.speakBlock(activeBlock, {
        startCharIndex: nextPosition.charIndex,
        rate: rateRef.current,
        voiceId: voiceIdRef.current,
        onStart: () => {
          setIsPlaying(true);
        },
        onBoundary: (event) => {
          if (!shouldKeepPlayingRef.current) {
            return;
          }

          const boundaryCharIndex = clamp(
            nextPosition.charIndex + event.charIndex,
            0,
            activeBlock.text.length,
          );

          setCurrentWordRange(getWordRangeAt(activeBlock.text, boundaryCharIndex));
          void persistPositionRef.current?.(nextPosition.blockIndex, boundaryCharIndex);
        },
        onDone: async () => {
          if (!shouldKeepPlayingRef.current) {
            return;
          }

          const isLastBlock = nextPosition.blockIndex >= activeDocument.blocks.length - 1;

          if (isLastBlock) {
            shouldKeepPlayingRef.current = false;
            setIsPlaying(false);
            setCurrentWordRange(null);
            await persistPositionRef.current?.(nextPosition.blockIndex, activeBlock.text.length, true);
            return;
          }

          await persistPositionRef.current?.(nextPosition.blockIndex + 1, 0, true);
          await speakFromPositionRef.current?.(nextPosition.blockIndex + 1, 0);
        },
        onStopped: () => {
          setIsPlaying(false);
          setCurrentWordRange(null);
        },
        onError: (error) => {
          reportError(error, 'La lectura en voz alta fallo.');
        },
      });
    } catch (error) {
      reportError(error, 'No se pudo continuar la lectura.');
    }
  };

  useEffect(() => {
    shouldKeepPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentWordRange(null);

    const nextPosition = getSafePosition(document, initialBlockIndex, initialCharIndex);
    positionRef.current = nextPosition;
    setCurrentBlockIndex(nextPosition.blockIndex);
    setCurrentCharIndex(nextPosition.charIndex);
    setProgressPercentage(calculatePercentage(document, nextPosition.blockIndex, nextPosition.charIndex));

    void speechService.stop().catch(() => {
      // No bloquear el lector por un fallo del motor al reiniciar el estado.
    });
  }, [document, initialBlockIndex, initialCharIndex]);

  useEffect(() => {
    return () => {
      shouldKeepPlayingRef.current = false;
      void speechService.stop().catch(() => {
        // Ignorado a proposito al desmontar.
      });
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        if (!shouldKeepPlayingRef.current) {
          return;
        }

        void (async () => {
          try {
            shouldKeepPlayingRef.current = false;
            await speechService.stop();
            setIsPlaying(false);

            await persistPositionRef.current?.(
              positionRef.current.blockIndex,
              positionRef.current.charIndex,
              true
            );
          } catch (error) {
            reportError(error, 'No se pudo guardar el punto actual al salir del lector.');
          }
        })();

        return;
      }

      if (nextState !== 'active') {
        return;
      }

      void (async () => {
        try {
          const isActuallySpeaking = await speechService.isSpeaking();

          setIsPlaying(isActuallySpeaking);

          if (isActuallySpeaking) {
            return;
          }

          shouldKeepPlayingRef.current = false;

          await persistPositionRef.current?.(
            positionRef.current.blockIndex,
            positionRef.current.charIndex,
            true
          );
        } catch (error) {
          reportError(error, 'No se pudo recuperar el estado del lector al volver a la app.');
        }
      })();
    });

    return () => {
      subscription.remove();
    };
  }, [reportError]);

  const play = useCallback(async () => {
    try {
      if (!documentRef.current) {
        return;
      }

      shouldKeepPlayingRef.current = true;
      await speakFromPositionRef.current?.();
    } catch (error) {
      reportError(error, 'No se pudo iniciar la lectura.');
    }
  }, [reportError]);

  const stop = useCallback(async () => {
    try {
      shouldKeepPlayingRef.current = false;
      await speechService.stop();
      setIsPlaying(false);
      setCurrentWordRange(null);
      await persistPositionRef.current?.(
        positionRef.current.blockIndex,
        positionRef.current.charIndex,
        true,
      );
    } catch (error) {
      reportError(error, 'No se pudo detener la lectura.');
    }
  }, [reportError]);

  const restartFromCurrent = useCallback(async () => {
    try {
      if (!documentRef.current) {
        return;
      }

      shouldKeepPlayingRef.current = true;
      await speechService.stop();
      await speakFromPositionRef.current?.();
    } catch (error) {
      reportError(error, 'No se pudo reanudar la lectura.');
    }
  }, [reportError]);

  const seekToBlock = useCallback(
    async (blockIndex: number, autoplay = false) => {
      try {
        const activeDocument = documentRef.current;

        if (!activeDocument || activeDocument.blocks.length === 0) {
          return;
        }

        shouldKeepPlayingRef.current = false;
        await speechService.stop();
        setIsPlaying(false);
        setCurrentWordRange(null);

        const nextBlockIndex = clamp(blockIndex, 0, activeDocument.blocks.length - 1);
        await persistPositionRef.current?.(nextBlockIndex, 0, true);

        if (autoplay) {
          shouldKeepPlayingRef.current = true;
          await speakFromPositionRef.current?.(nextBlockIndex, 0);
        }
      } catch (error) {
        reportError(error, 'No se pudo mover la lectura al bloque elegido.');
      }
    },
    [reportError],
  );

  const nextBlock = useCallback(async () => {
    await seekToBlock(positionRef.current.blockIndex + 1, shouldKeepPlayingRef.current);
  }, [seekToBlock]);

  const previousBlock = useCallback(async () => {
    await seekToBlock(positionRef.current.blockIndex - 1, shouldKeepPlayingRef.current);
  }, [seekToBlock]);

  return {
    currentBlockIndex,
    currentCharIndex,
    currentWordRange,
    progressPercentage,
    isPlaying,
    play,
    stop,
    restartFromCurrent,
    nextBlock,
    previousBlock,
    seekToBlock,
  };
}
