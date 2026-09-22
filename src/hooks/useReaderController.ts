import { useCallback, useEffect, useRef, useState } from 'react';

import { documentAudioPlaybackService } from '../services/documentAudioPlaybackService';
import { ParsedDocument } from '../types/document';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../utils/documentProgress';
import { clamp } from '../utils/math';
import { progressFootprint } from '../utils/progressRemap';
import { WordRange, getWordRangeAt } from '../utils/wordRange';

type ProgressSnapshot = {
  blockIndex: number;
  charIndex: number;
  percentage: number;
  absoluteCharIndex: number;
  page: number | null;
  textLength: number;
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

function buildMetadata(document: ParsedDocument) {
  return {
    title: document.fileName,
    artist: 'Bardo',
  };
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
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState(0);

  const documentRef = useRef<ParsedDocument | null>(document);
  const rateRef = useRef(rate);
  const voiceIdRef = useRef(voiceId);
  const onProgressChangeRef = useRef(onProgressChange);
  const onErrorRef = useRef(onError);
  const absoluteCharIndexRef = useRef(0);
  const currentBlockIndexRef = useRef(0);
  const currentCharIndexRef = useRef(0);
  const lastPersistedAtRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const lastServiceErrorRef = useRef<string | null>(null);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    rateRef.current = rate;
    // Solo tocamos el player global si ESTE documento es el que suena; si no,
    // ajustaríamos la velocidad del audio de otro libro que quedó sonando.
    if (documentAudioPlaybackService.getSnapshot().documentId === document?.id) {
      documentAudioPlaybackService.setPlaybackRate(rate);
    }
  }, [rate, document?.id]);

  useEffect(() => {
    voiceIdRef.current = voiceId;
    // Aplica la voz nueva a los próximos tramos si este documento es el activo.
    if (documentAudioPlaybackService.getSnapshot().documentId === document?.id) {
      documentAudioPlaybackService.setVoice(voiceId);
    }
  }, [voiceId, document?.id]);

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const reportError = useCallback((error: unknown, fallback: string) => {
    const message = error instanceof Error && error.message.trim() ? error.message : fallback;
    onErrorRef.current?.(message);
  }, []);

  /**
   * Mueve la posición y, si toca, la guarda.
   *
   * `skipPersist` es para los avisos que llegan del reproductor MIENTRAS suena:
   * ahí el servicio de audio ya guarda por su cuenta, y sin esto la misma
   * posición se escribía dos veces por segundo durante toda la escucha (una
   * saga son horas). La pantalla igual se actualiza.
   */
  const persistAbsoluteChar = useCallback(async (absoluteCharIndex: number, force = false, skipPersist = false) => {
    const activeDocument = documentRef.current;
    // Sin documento (primer render, antes de que cargue) NO persistimos: si no,
    // getPositionFromAbsoluteChar(null) devuelve 0/0/0 y pisaría el progreso
    // guardado con ceros si el usuario cierra la app durante la carga.
    if (!activeDocument) return;
    const nextPosition = getPositionFromAbsoluteChar(activeDocument, absoluteCharIndex);

    absoluteCharIndexRef.current = nextPosition.absoluteCharIndex;
    currentBlockIndexRef.current = nextPosition.blockIndex;
    currentCharIndexRef.current = nextPosition.charIndex;

    setCurrentBlockIndex(nextPosition.blockIndex);
    setCurrentCharIndex(nextPosition.charIndex);
    // Redondeado: con dos decimales cambiaba en cada aviso del reproductor
    // (cuatro por segundo) y volvía a dibujar la pantalla entera del lector
    // por un número que se muestra sin decimales.
    setProgressPercentage((previous) =>
      Math.round(previous * 10) === Math.round(nextPosition.percentage * 10) ? previous : nextPosition.percentage,
    );

    const activeBlock = activeDocument?.blocks[nextPosition.blockIndex];
    const nextWordRange = activeBlock ? getWordRangeAt(activeBlock.text, nextPosition.charIndex) : null;
    // Mientras la voz lee una palabra larga hay varios avisos con el MISMO
    // rango; devolver un objeto nuevo cada vez redibujaba el lector igual.
    setCurrentWordRange((previous) =>
      previous?.start === nextWordRange?.start && previous?.end === nextWordRange?.end ? previous : nextWordRange,
    );

    const shouldPersist = !skipPersist && (force || Date.now() - lastPersistedAtRef.current > 700);

    if (shouldPersist) {
      lastPersistedAtRef.current = Date.now();
      await onProgressChangeRef.current?.({
        blockIndex: nextPosition.blockIndex,
        charIndex: nextPosition.charIndex,
        percentage: nextPosition.percentage,
        absoluteCharIndex: nextPosition.absoluteCharIndex,
        ...progressFootprint(activeDocument, nextPosition.absoluteCharIndex),
      });
    }
  }, []);

  useEffect(() => {
    const initialAbsoluteCharIndex = getAbsoluteCharIndex(
      document,
      initialBlockIndex,
      initialCharIndex,
    );

    void persistAbsoluteChar(initialAbsoluteCharIndex, true);

    const serviceSnapshot = documentAudioPlaybackService.getSnapshot();

    // La posición del audio manda SOLO si está sonando ahora. Un audio cargado
    // pero pausado hace rato no debe pisar el progreso guardado (p. ej. si
    // después seguiste leyendo páginas y volviste a entrar).
    if (
      document &&
      serviceSnapshot.documentId === document.id &&
      serviceSnapshot.duration > 0 &&
      serviceSnapshot.isPlaying
    ) {
      const chunkLength = Math.max(
        serviceSnapshot.chunkEndChar - serviceSnapshot.chunkStartChar,
        1,
      );
      const serviceAbsoluteCharIndex = clamp(
        serviceSnapshot.chunkStartChar +
          Math.round((serviceSnapshot.currentTime / serviceSnapshot.duration) * chunkLength),
        0,
        document.fullText.length,
      );

      void persistAbsoluteChar(serviceAbsoluteCharIndex, true);
      setIsPlaying(serviceSnapshot.isPlaying);
    } else {
      setIsPlaying(false);
    }

    setIsPreparing(serviceSnapshot.documentId === document?.id ? serviceSnapshot.isPreparing : false);
    setPreparationProgress(
      serviceSnapshot.documentId === document?.id ? serviceSnapshot.preparationProgress : 0,
    );
  }, [document, initialBlockIndex, initialCharIndex, persistAbsoluteChar]);

  useEffect(() => {
    return documentAudioPlaybackService.subscribe((snapshot) => {
      const activeDocument = documentRef.current;
      const isCurrentDocument = snapshot.documentId === activeDocument?.id;

      setIsPreparing(isCurrentDocument ? snapshot.isPreparing : false);
      setPreparationProgress(isCurrentDocument ? snapshot.preparationProgress : 0);

      if (!activeDocument || !isCurrentDocument) {
        return;
      }

      // Un fallo al pasar de tramo ocurre fuera de play()/stop(): sin esto la voz
      // se cortaba y la pantalla no decía nada.
      if (snapshot.errorMessage && snapshot.errorMessage !== lastServiceErrorRef.current) {
        onErrorRef.current?.(snapshot.errorMessage);
      }
      lastServiceErrorRef.current = snapshot.errorMessage;

      setIsPlaying(snapshot.isPlaying);

      if (!snapshot.isLoaded && !snapshot.isPlaying && snapshot.currentTime <= 0) {
        return;
      }

      if (!snapshot.duration || activeDocument.fullText.length === 0) {
        return;
      }

      // Sin tramo activo (grilla rehecha, otro libro) el rango llega en 0-0 y
      // esto guardaría el principio del libro encima del progreso real.
      if (snapshot.chunkCount === 0 || snapshot.chunkEndChar <= snapshot.chunkStartChar) {
        return;
      }

      if (snapshot.didJustFinish) {
        void persistAbsoluteChar(activeDocument.fullText.length, true);
        return;
      }

      const chunkLength = Math.max(snapshot.chunkEndChar - snapshot.chunkStartChar, 1);
      const absoluteCharIndex = clamp(
        snapshot.chunkStartChar + Math.round((snapshot.currentTime / snapshot.duration) * chunkLength),
        0,
        activeDocument.fullText.length,
      );

      // Sonando manda el servicio de audio, que ya escribe él mismo.
      void persistAbsoluteChar(absoluteCharIndex, !snapshot.isPlaying, snapshot.isPlaying);
    });
  }, [persistAbsoluteChar]);

  const runAction = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;

      try {
        await action();
      } catch (error) {
        reportError(error, fallback);
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [reportError],
  );

  const play = useCallback(async () => {
    await runAction(async () => {
      const activeDocument = documentRef.current;
      if (!activeDocument) {
        return;
      }

      await documentAudioPlaybackService.play(
        activeDocument,
        voiceIdRef.current,
        rateRef.current,
        absoluteCharIndexRef.current,
        buildMetadata(activeDocument),
      );
    }, 'No se pudo iniciar la lectura.');
  }, [runAction]);

  const stop = useCallback(async () => {
    await runAction(async () => {
      await documentAudioPlaybackService.pause();
      await persistAbsoluteChar(absoluteCharIndexRef.current, true);
      setIsPlaying(false);
    }, 'No se pudo detener la lectura.');
  }, [persistAbsoluteChar, runAction]);

  const restartFromCurrent = useCallback(async () => {
    await play();
  }, [play]);

  const seekToBlock = useCallback(
    async (blockIndex: number, autoplay = false) => {
      await runAction(async () => {
        const activeDocument = documentRef.current;
        if (!activeDocument || activeDocument.blocks.length === 0) {
          return;
        }

        const nextBlockIndex = clamp(blockIndex, 0, activeDocument.blocks.length - 1);
        const absoluteCharIndex = getAbsoluteCharIndex(activeDocument, nextBlockIndex, 0);

        await persistAbsoluteChar(absoluteCharIndex, true);

        if (autoplay) {
          await documentAudioPlaybackService.play(
            activeDocument,
            voiceIdRef.current,
            rateRef.current,
            absoluteCharIndex,
            buildMetadata(activeDocument),
          );
          return;
        }

        await documentAudioPlaybackService.seekToBlock(
          activeDocument,
          nextBlockIndex,
          0,
          false,
          voiceIdRef.current,
          rateRef.current,
          buildMetadata(activeDocument),
        );
      }, 'No se pudo mover la lectura al bloque elegido.');
    },
    [persistAbsoluteChar, runAction],
  );

  const nextBlock = useCallback(async () => {
    await seekToBlock(currentBlockIndexRef.current + 1, isPlaying);
  }, [isPlaying, seekToBlock]);

  const previousBlock = useCallback(async () => {
    await seekToBlock(currentBlockIndexRef.current - 1, isPlaying);
  }, [isPlaying, seekToBlock]);

  const shutdown = useCallback(async () => {
    await persistAbsoluteChar(absoluteCharIndexRef.current, true);
  }, [persistAbsoluteChar]);

  /**
   * Sincroniza la posición SIN tocar el audio (la usa el lector visual de
   * páginas). Es clave que pase por acá: el guardado final al salir escribe
   * la posición del controlador — si no se actualiza, pisa el progreso.
   */
  const syncPosition = useCallback(
    async (blockIndex: number, charIndex: number) => {
      const absoluteCharIndex = getAbsoluteCharIndex(documentRef.current, blockIndex, charIndex);
      await persistAbsoluteChar(absoluteCharIndex, true);
    },
    [persistAbsoluteChar],
  );

  return {
    currentBlockIndex,
    currentCharIndex,
    currentWordRange,
    progressPercentage,
    isPlaying,
    isPreparing,
    preparationProgress,
    play,
    stop,
    shutdown,
    syncPosition,
    restartFromCurrent,
    nextBlock,
    previousBlock,
    seekToBlock,
  };
}
