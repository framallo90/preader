import {
  AudioMetadata,
  AudioPlayer,
  AudioStatus,
  createAudioPlayer,
} from 'expo-audio';

import { bookProgressRepository } from '../storage/bookProgressRepository';
import { ParsedDocument } from '../types/document';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../utils/documentProgress';
import { clamp } from '../utils/math';
import { SynthesisChunk, buildSynthesisChunks } from '../utils/synthesisSegments';
import { audioSessionService } from './audioSessionService';
import { synthesizeSpeech, DEFAULT_VOICE, DEFAULT_MODEL, TtsVoice, TtsModel } from './openaiTtsService';

export type PlaybackSnapshot = {
  documentId: string | null;
  voiceId: string | null;
  sourceUri: string | null;
  isPreparing: boolean;
  preparationProgress: number;
  isLoaded: boolean;
  isPlaying: boolean;
  didJustFinish: boolean;
  currentTime: number;
  duration: number;
  chunkIndex: number;
  chunkCount: number;
  chunkStartChar: number;
  chunkEndChar: number;
  errorMessage: string | null;
};

type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

const DEFAULT_SNAPSHOT: PlaybackSnapshot = {
  documentId: null,
  voiceId: null,
  sourceUri: null,
  isPreparing: false,
  preparationProgress: 0,
  isLoaded: false,
  isPlaying: false,
  didJustFinish: false,
  currentTime: 0,
  duration: 0,
  chunkIndex: 0,
  chunkCount: 0,
  chunkStartChar: 0,
  chunkEndChar: 0,
  errorMessage: null,
};

function getChunkLength(chunk: SynthesisChunk | null) {
  if (!chunk) return 0;
  return Math.max(chunk.endChar - chunk.startChar, 1);
}

function buildChunkId(documentId: string, chunk: SynthesisChunk, voiceId: string) {
  // Incluye el rango de caracteres del tramo: si cambia el chunking (tamaño de
  // tramo), la clave cambia y no se reutiliza un WAV viejo por un tramo distinto.
  const len = chunk.endChar - chunk.startChar;
  return `${documentId}--chunk-${chunk.index}-${chunk.startChar}-${len}--${voiceId}`;
}

class DocumentAudioPlaybackService {
  private player: AudioPlayer | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private listeners = new Set<PlaybackListener>();
  private snapshot: PlaybackSnapshot = DEFAULT_SNAPSHOT;
  private playbackSessionId = 0;
  private activeSourceKey: string | null = null;
  private activeDocument: ParsedDocument | null = null;
  private activeChunks: SynthesisChunk[] = [];
  private activeChunkIndex = 0;
  private activePlaybackRate = 1;
  private activeVoiceId: string = DEFAULT_VOICE;
  private activeMetadata: AudioMetadata | undefined;
  private lastPersistedAt = 0;
  private lastPersistedAbsoluteCharIndex = -1;
  private lastObservedIsPlaying = false;
  private advancingPromise: Promise<void> | null = null;
  private chunkPreparationPromises = new Map<string, Promise<string | null>>();

  private emit() {
    const snap = { ...this.snapshot };
    this.listeners.forEach((l) => l(snap));
  }

  private updateSnapshot(partial: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
  }

  private getActiveChunk() {
    return this.activeChunks[this.activeChunkIndex] ?? null;
  }

  private startPlaybackSession() {
    this.playbackSessionId += 1;
    return this.playbackSessionId;
  }

  private isSessionActive(sessionId: number) {
    return this.playbackSessionId === sessionId;
  }

  private resetPlaybackState() {
    this.snapshot = DEFAULT_SNAPSHOT;
    this.activeSourceKey = null;
    this.activeDocument = null;
    this.activeChunks = [];
    this.activeChunkIndex = 0;
    this.activePlaybackRate = 1;
    this.activeMetadata = undefined;
    this.lastPersistedAt = 0;
    this.lastPersistedAbsoluteCharIndex = -1;
    this.advancingPromise = null;
    this.chunkPreparationPromises.clear();
  }

  private getChunkIndexForAbsoluteChar(absoluteCharIndex: number) {
    if (this.activeChunks.length === 0) return 0;
    const safe = clamp(absoluteCharIndex, 0, this.activeDocument?.fullText.length ?? 0);
    for (let i = 0; i < this.activeChunks.length; i++) {
      if (safe <= this.activeChunks[i].endChar) return i;
    }
    return Math.max(this.activeChunks.length - 1, 0);
  }

  private handlePlayerStatus = (status: AudioStatus) => {
    const activeChunk = this.getActiveChunk();
    const isLastChunk = this.activeChunkIndex >= this.activeChunks.length - 1;
    const didFinishDocument = Boolean(status.didJustFinish && isLastChunk);

    this.updateSnapshot({
      currentTime: status.currentTime,
      duration: status.duration,
      isLoaded: status.isLoaded,
      isPlaying: status.playing,
      didJustFinish: didFinishDocument,
      chunkIndex: this.activeChunkIndex,
      chunkCount: this.activeChunks.length,
      chunkStartChar: activeChunk?.startChar ?? 0,
      chunkEndChar: activeChunk?.endChar ?? 0,
    });

    // Forzamos persistencia solo al terminar o en la TRANSICIÓN a pausa,
    // no en cada tick de status mientras está pausado (escribiría SQLite cada 250 ms).
    const justPaused = this.lastObservedIsPlaying && !status.playing;
    this.lastObservedIsPlaying = status.playing;
    void this.persistProgressFromStatus(status, status.didJustFinish || justPaused);

    if (status.didJustFinish && !isLastChunk) {
      // Marca el hueco entre tramos como "preparando" YA: si no, por un instante
      // isPlaying=false sin isPreparing y la UI muestra ▶ como si estuviera
      // parado — un toque ahí reiniciaba el tramo anterior (play bugueado).
      this.updateSnapshot({ isPreparing: true });
      void this.advanceToNextChunk();
    }
  };

  private async persistProgressFromStatus(status: AudioStatus, force = false) {
    const doc = this.activeDocument;
    const chunk = this.getActiveChunk();

    if (!doc || !chunk || !status.isLoaded || !status.duration || doc.fullText.length === 0) return;

    const absoluteCharIndex = status.didJustFinish
      ? this.activeChunkIndex >= this.activeChunks.length - 1
        ? doc.fullText.length
        : chunk.endChar
      : clamp(
          chunk.startChar + Math.round((status.currentTime / status.duration) * getChunkLength(chunk)),
          chunk.startChar,
          chunk.endChar,
        );

    if (!force && absoluteCharIndex === this.lastPersistedAbsoluteCharIndex) return;
    if (!force && Date.now() - this.lastPersistedAt < 1500) return;

    const pos = getPositionFromAbsoluteChar(doc, absoluteCharIndex);
    this.lastPersistedAbsoluteCharIndex = absoluteCharIndex;
    this.lastPersistedAt = Date.now();

    await bookProgressRepository.saveProgress({
      bookId: doc.id,
      chapterId: null, // chapterRepository.getChapterAtChar puede enriquecer esto async
      blockIndex: pos.blockIndex,
      charIndex: pos.charIndex,
      percentage: pos.percentage,
    });
  }

  private ensurePlayer() {
    if (!this.player) {
      this.player = createAudioPlayer(null, { keepAudioSessionActive: true, updateInterval: 250 });
      this.playerSubscription = this.player.addListener('playbackStatusUpdate', this.handlePlayerStatus);
    }
    return this.player;
  }

  private async waitUntilLoaded(player: AudioPlayer, sessionId: number) {
    if (!this.isSessionActive(sessionId) || player.currentStatus.isLoaded) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => { if (!settled) { settled = true; clearTimeout(t); clearInterval(i); sub.remove(); } };
      const t = setTimeout(() => { cleanup(); reject(new Error('El reproductor tardó demasiado en cargar el audio.')); }, 30000);
      const i = setInterval(() => { if (!this.isSessionActive(sessionId)) { cleanup(); resolve(); } }, 100);
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (!this.isSessionActive(sessionId)) { cleanup(); resolve(); return; }
        if (s.isLoaded) { cleanup(); resolve(); }
      });
    });
  }

  /** Sintetiza un chunk con OpenAI TTS y cachea el MP3. */
  private async prepareChunk(
    document: ParsedDocument,
    chunk: SynthesisChunk,
    voiceId: string,
    sessionId: number,
    silent = false,
  ): Promise<string | null> {
    const chunkId = buildChunkId(document.id, chunk, voiceId);
    const existing = this.chunkPreparationPromises.get(chunkId);
    if (existing) return existing;

    if (!silent) {
      this.updateSnapshot({ documentId: document.id, voiceId, isPreparing: true, preparationProgress: 0, errorMessage: null });
    }

    // Texto ORIGINAL del tramo (no reconstruido): así fluye natural, con las
    // pausas sólo en los párrafos reales. Reconstruir uniendo oraciones con "\n\n"
    // hacía que fal pausara entre cada oración (y a mitad de oraciones largas
    // partidas) → sonaba cortado "como si hubiera un punto". El texto ya viene
    // limpio y normalizado del parser, y sin LLM de por medio (latencia extra).
    const rawText = document.fullText.slice(chunk.startChar, chunk.endChar);
    const promise = synthesizeSpeech(chunkId, rawText, voiceId as TtsVoice, DEFAULT_MODEL)
      .then((mp3Uri) => {
        if (!this.isSessionActive(sessionId)) return null;
        if (!silent) this.updateSnapshot({ sourceUri: mp3Uri, isPreparing: false, preparationProgress: 1 });
        return mp3Uri;
      })
      .catch((error) => {
        if (!this.isSessionActive(sessionId)) return null;
        const rawMessage = error instanceof Error ? error.message : 'No se pudo preparar el audio.';
        // Mensaje claro para usuarios sin Premium (la Edge Function devuelve 403).
        const message = /premium/i.test(rawMessage)
          ? 'Las voces de IA son parte de Premium. Podés activarlo desde Ajustes → Premium.'
          : rawMessage;
        if (!silent) this.updateSnapshot({ isPreparing: false, errorMessage: message });
        throw error;
      })
      .finally(() => {
        this.chunkPreparationPromises.delete(chunkId);
        if (!silent && this.isSessionActive(sessionId)) this.updateSnapshot({ isPreparing: false });
      });

    this.chunkPreparationPromises.set(chunkId, promise);
    return promise;
  }

  private async prefetchNextChunk(document: ParsedDocument, voiceId: string, chunkIndex: number, sessionId: number) {
    if (!this.isSessionActive(sessionId)) return;
    const nextChunk = this.activeChunks[chunkIndex + 1];
    if (!nextChunk) return;
    try { await this.prepareChunk(document, nextChunk, voiceId, sessionId, true); } catch { /* silencioso */ }
  }

  private async ensureChunkLoaded(
    document: ParsedDocument,
    voiceId: string,
    absoluteCharIndex: number,
    sessionId: number,
    targetIndexOverride?: number,
  ) {
    await audioSessionService.ensureReady();
    if (!this.isSessionActive(sessionId)) return null;

    this.activeDocument = document;
    this.activeChunks = buildSynthesisChunks(document.fullText);

    if (this.activeChunks.length === 0) throw new Error('No se pudieron preparar tramos de audio.');

    const player = this.ensurePlayer();
    // El avance de tramo pasa el índice EXPLÍCITO: buscarlo por offset podía
    // devolver el tramo anterior si los offsets quedaron solapados, y eso
    // re-reproducía el mismo tramo en loop infinito.
    const targetIndex =
      targetIndexOverride !== undefined
        ? clamp(targetIndexOverride, 0, this.activeChunks.length - 1)
        : this.getChunkIndexForAbsoluteChar(absoluteCharIndex);
    const targetChunk = this.activeChunks[targetIndex];
    const mp3Uri = await this.prepareChunk(document, targetChunk, voiceId, sessionId);

    if (!mp3Uri || !this.isSessionActive(sessionId)) return null;

    const sourceKey = `${document.id}:${voiceId}:${targetChunk.index}`;

    if (this.activeSourceKey !== sourceKey) {
      this.lastPersistedAt = 0;
      this.lastPersistedAbsoluteCharIndex = -1;
      if (player.currentStatus.playing) player.pause();
      player.replace({ uri: mp3Uri, name: `${document.fileName} · ${targetChunk.index + 1}/${this.activeChunks.length}` });
      this.activeSourceKey = sourceKey;
      this.activeChunkIndex = targetIndex;
      await this.waitUntilLoaded(player, sessionId);
    } else if (!player.currentStatus.isLoaded) {
      await this.waitUntilLoaded(player, sessionId);
    } else {
      this.activeChunkIndex = targetIndex;
    }

    if (!this.isSessionActive(sessionId)) return null;

    this.updateSnapshot({
      documentId: document.id,
      voiceId,
      sourceUri: mp3Uri,
      isLoaded: player.currentStatus.isLoaded,
      currentTime: player.currentStatus.currentTime,
      duration: player.currentStatus.duration,
      didJustFinish: false,
      chunkIndex: this.activeChunkIndex,
      chunkCount: this.activeChunks.length,
      chunkStartChar: targetChunk.startChar,
      chunkEndChar: targetChunk.endChar,
      errorMessage: null,
    });

    void this.prefetchNextChunk(document, voiceId, targetIndex, sessionId);
    return targetChunk;
  }

  private async advanceToNextChunk() {
    console.log('[audio] avanzando de tramo', this.activeChunkIndex, '->', this.activeChunkIndex + 1);
    if (this.advancingPromise || !this.activeDocument) return;
    const nextChunk = this.activeChunks[this.activeChunkIndex + 1];
    if (!nextChunk) {
      // Sin tramo siguiente: no dejar el "Preparando…" pegado.
      this.updateSnapshot({ isPreparing: false });
      return;
    }

    const doc = this.activeDocument;
    const voiceId = this.activeVoiceId;
    const rate = this.activePlaybackRate;
    const metadata = this.activeMetadata;
    const sessionId = this.playbackSessionId;
    const expectedIndex = this.activeChunkIndex;

    const task = (async () => {
      if (!this.isSessionActive(sessionId) || this.activeChunkIndex !== expectedIndex) {
        // Otro flujo tomó el control: soltar el estado de "preparando".
        if (this.isSessionActive(sessionId)) this.updateSnapshot({ isPreparing: false });
        return;
      }
      await this.ensureChunkLoaded(doc, voiceId, nextChunk.startChar, sessionId, expectedIndex + 1);
      if (!this.isSessionActive(sessionId) || !this.player) return;
      this.player.setPlaybackRate(rate);
      this.player.setActiveForLockScreen(true, metadata ?? { title: doc.fileName, artist: 'intelliReader' });
      await this.player.seekTo(0);
      if (!this.isSessionActive(sessionId)) return;
      this.player.play();
    })();

    this.advancingPromise = task
      .catch((err) => {
        if (!this.isSessionActive(sessionId)) return;
        this.updateSnapshot({ isPlaying: false, errorMessage: err instanceof Error ? err.message : 'No se pudo continuar el audio.' });
      })
      .finally(() => { if (this.advancingPromise === task) this.advancingPromise = null; });

    await this.advancingPromise;
  }

  private async seekWithinActiveChunk(absoluteCharIndex: number) {
    const player = this.ensurePlayer();
    const chunk = this.getActiveChunk();
    const duration = player.currentStatus.duration || this.snapshot.duration;
    if (!chunk || !duration) return;
    const safe = clamp(absoluteCharIndex, chunk.startChar, chunk.endChar);
    const seconds = ((safe - chunk.startChar) / getChunkLength(chunk)) * duration;
    await player.seekTo(seconds);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  subscribe(listener: PlaybackListener) {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot() { return { ...this.snapshot }; }

  async play(document: ParsedDocument, voiceId: string | null, rate: number, absoluteCharIndex: number, metadata?: AudioMetadata) {
    const resolvedVoice = (voiceId ?? DEFAULT_VOICE) as TtsVoice;
    const sessionId = this.startPlaybackSession();
    this.activePlaybackRate = rate;
    this.activeVoiceId = resolvedVoice;
    this.activeMetadata = metadata;

    await this.ensureChunkLoaded(document, resolvedVoice, absoluteCharIndex, sessionId);
    if (!this.isSessionActive(sessionId) || !this.player) return;

    await audioSessionService.ensureNotificationPermission();
    if (!this.isSessionActive(sessionId) || !this.player) return;

    this.player.setPlaybackRate(rate);
    this.player.setActiveForLockScreen(true, metadata ?? { title: document.fileName, artist: 'intelliReader' });
    await this.seekWithinActiveChunk(absoluteCharIndex);
    if (!this.isSessionActive(sessionId)) return;
    this.player.play();
  }

  async pause() {
    if (!this.player) return;
    this.player.pause();
    await this.persistProgressFromStatus(this.player.currentStatus, true);
  }

  async seekToBlock(document: ParsedDocument, blockIndex: number, charIndex: number, autoplay: boolean, voiceId: string | null, rate: number, metadata?: AudioMetadata) {
    const absoluteCharIndex = getAbsoluteCharIndex(document, blockIndex, charIndex);
    if (autoplay) { await this.play(document, voiceId, rate, absoluteCharIndex, metadata); return; }
    const resolvedVoice = (voiceId ?? DEFAULT_VOICE) as TtsVoice;
    const sessionId = this.startPlaybackSession();
    await this.ensureChunkLoaded(document, resolvedVoice, absoluteCharIndex, sessionId);
    if (!this.isSessionActive(sessionId)) return;
    await this.seekWithinActiveChunk(absoluteCharIndex);
    this.player?.pause();
  }

  setPlaybackRate(rate: number) {
    this.activePlaybackRate = rate;
    if (this.player) this.player.setPlaybackRate(rate);
  }

  /**
   * Retrocede N segundos dentro del tramo actual (urgencias: teléfono, puerta,
   * quedarse dormido). Clampa al inicio del tramo.
   */
  async rewindBy(seconds: number) {
    await this.seekBy(-seconds);
  }

  /**
   * Salta ± N segundos dentro del tramo actual. Si el salto cae al final del
   * tramo, pasa directo al siguiente (saltar EXACTO al fin del archivo dejaba
   * el player en un limbo "terminado sin evento" y el audio quedaba pensando).
   */
  async seekBy(deltaSeconds: number) {
    if (!this.player || !this.player.currentStatus.isLoaded) return;
    const status = this.player.currentStatus;
    const duration = status.duration || 0;
    const target = status.currentTime + deltaSeconds;

    if (deltaSeconds > 0 && duration > 0 && target >= duration - 0.75) {
      const hasNext = this.activeChunkIndex < this.activeChunks.length - 1;
      if (hasNext) {
        this.updateSnapshot({ isPreparing: true });
        await this.advanceToNextChunk();
        return;
      }
      // Último tramo: quedarse justo antes del final, sin caer al limbo.
      await this.player.seekTo(Math.max(0, duration - 0.75));
      return;
    }

    await this.player.seekTo(Math.max(0, Math.min(duration > 0 ? duration - 0.25 : target, target)));
  }

  async stopAndUnload() {
    let capturedError: unknown = null;
    try {
      if (this.player) {
        this.player.setActiveForLockScreen(false);
        if (this.player.currentStatus.playing) await this.player.pause();
        await this.persistProgressFromStatus(this.player.currentStatus, true);
      }
    } catch (e) { capturedError = e; }
    finally {
      try { this.unload(); } catch (e) { if (!capturedError) capturedError = e; }
    }
    if (capturedError) throw capturedError;
  }

  unload() {
    this.playbackSessionId += 1;
    this.playerSubscription?.remove();
    this.playerSubscription = null;
    this.player?.release();
    this.player = null;
    this.resetPlaybackState();
    this.emit();
  }
}

export const documentAudioPlaybackService = new DocumentAudioPlaybackService();
export type DocumentPlaybackSnapshot = PlaybackSnapshot;
