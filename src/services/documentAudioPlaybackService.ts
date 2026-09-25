import {
  AudioMetadata,
  AudioPlayer,
  AudioStatus,
  createAudioPlayer,
} from 'expo-audio';

import { AppState } from 'react-native';

import { bookProgressRepository } from '../storage/bookProgressRepository';
import { runtimeStateRepository } from '../storage/runtimeStateRepository';
import { ParsedDocument } from '../types/document';
import { getAbsoluteCharIndex, getPositionFromAbsoluteChar } from '../utils/documentProgress';
import { pagePercentage, progressFootprint } from '../utils/progressRemap';
import { detectLanguage } from '../utils/languageDetect';
import { clamp } from '../utils/math';
import { prepareSpeechText } from '../utils/speechText';
import { Pronunciation, applyPronunciations, cleanPronunciations, textSignature } from '../utils/pronunciation';
import { countableSeconds, dayKey } from '../utils/readingStats';
import { statsRepository } from '../storage/statsRepository';
import { SynthesisChunk, buildAnchoredChunks, buildSentenceSpans, chunkIndexForChar } from '../utils/synthesisSegments';
import { Span } from '../utils/textSpans';
import { resolveVoice } from '../utils/voices';
import { audioSessionService } from './audioSessionService';
import { cancelPendingSynthesis, listVoices, synthesizeSpeech } from './systemTtsService';
import { isMusicActive } from '../../modules/bardo-keys';

// Cuántos tramos se sintetizan por adelantado. Los tramos son cortos (arranque
// rápido), así que con dos de colchón la voz no espera al motor entre tramos.
const PREFETCH_DEPTH = 2;

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

function buildChunkId(documentId: string, chunk: SynthesisChunk, voiceId: string | null) {
  // La clave es el RANGO de texto (no el número de tramo): la grilla de tramos se
  // ancla donde se empieza a escuchar, así que el mismo trozo de texto puede ser
  // el tramo 3 hoy y el 7 mañana, y el audio ya sintetizado tiene que servir igual.
  const len = chunk.endChar - chunk.startChar;
  return `${documentId}--chunk-${chunk.startChar}-${len}--${voiceId ?? 'default'}`;
}

/** Entre dos avisos del reproductor pasa ~250 ms; más que esto es un hueco, no escucha. */
const LISTEN_MAX_GAP_MS = 5000;
/** Se guarda de a un minuto: escribir en la base cuatro veces por segundo no tiene sentido. */
const LISTEN_FLUSH_SECONDS = 60;

class DocumentAudioPlaybackService {
  /**
   * Tiempo escuchado para las estadísticas. Se cuenta ACÁ y no en el lector
   * porque la voz sigue sonando aunque salgas del libro (o con la pantalla
   * apagada), y es justo el uso que más importa medir.
   */
  private listenStats = { bookId: null as string | null, seconds: 0, lastAt: 0 };

  private trackListening(playing: boolean) {
    const now = Date.now();
    const acc = this.listenStats;
    const doc = this.activeDocument;
    if (playing && doc) {
      if (acc.bookId !== doc.id) {
        this.flushListening();
        acc.bookId = doc.id;
      }
      acc.seconds += countableSeconds(now - acc.lastAt, LISTEN_MAX_GAP_MS);
    }
    acc.lastAt = now;
    if (acc.seconds >= LISTEN_FLUSH_SECONDS || (!playing && acc.seconds > 0)) this.flushListening();
  }

  private flushListening() {
    const acc = this.listenStats;
    if (acc.bookId && acc.seconds > 0) {
      void statsRepository.addSeconds(acc.bookId, dayKey(new Date()), 'listen', acc.seconds).catch(() => {});
    }
    acc.seconds = 0;
  }

  /** Diccionario de pronunciación vigente (Ajustes → Voz). */
  private pronunciations: Pronunciation[] = [];

  setPronunciations(entries: Pronunciation[]) {
    this.pronunciations = cleanPronunciations(entries);
  }

  /** Lo que el motor de voz va a decir para este tramo. */
  private spokenTextFor(document: ParsedDocument, chunk: SynthesisChunk): string {
    // prepareSpeechText une los renglones cortados del PDF (que el motor leería
    // como pausas) sin cambiar el largo del tramo; después se aplica el
    // diccionario de pronunciación, que sí puede cambiarlo (ver pronunciation.ts).
    const raw = prepareSpeechText(document.fullText.slice(chunk.startChar, chunk.endChar));
    return applyPronunciations(raw, this.pronunciations);
  }

  /**
   * Clave del audio de un tramo. Si el diccionario cambió lo que se dice, la
   * clave lleva la firma del texto hablado: si no, al cambiar una pronunciación
   * se seguiría reproduciendo el audio viejo, con el nombre mal dicho.
   */
  private chunkIdFor(document: ParsedDocument, chunk: SynthesisChunk, voiceId: string | null): string {
    const base = buildChunkId(document.id, chunk, voiceId);
    if (this.pronunciations.length === 0) return base;
    const raw = prepareSpeechText(document.fullText.slice(chunk.startChar, chunk.endChar));
    const spoken = applyPronunciations(raw, this.pronunciations);
    return spoken === raw ? base : `${base}--p${textSignature(spoken)}`;
  }

  private player: AudioPlayer | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private listeners = new Set<PlaybackListener>();
  private snapshot: PlaybackSnapshot = DEFAULT_SNAPSHOT;
  private playbackSessionId = 0;
  // Sube en cada pausa. El avance al tramo siguiente lo mira justo antes de
  // sonar: sin esto, pausar durante el hueco entre tramos (notificación o
  // pantalla bloqueada) no se notaba y la voz arrancaba sola al terminar.
  private pauseGeneration = 0;
  private activeSourceKey: string | null = null;
  private activeDocument: ParsedDocument | null = null;
  private activeChunks: SynthesisChunk[] = [];
  // Oraciones del documento activo: lo único caro (recorrer el texto entero) se
  // hace una vez; los tramos se re-arman desde ellas en milisegundos cada vez que
  // el usuario arranca a escuchar desde otro punto.
  private sentencesDocId: string | null = null;
  private sentencesLen = -1;
  private sentences: Span[] = [];
  private activeChunkIndex = 0;
  private activePlaybackRate = 1;
  // Voz RESUELTA para el libro activo (según su idioma) y la elegida en Ajustes.
  private activeVoiceId: string | null = null;
  private activeLanguage: string | null = null;
  private preferredVoiceId: string | null = null;
  private languageByDocument = new Map<string, string | null>();
  private activeMetadata: AudioMetadata | undefined;
  private lastPersistedAt = 0;
  private lastPersistedAbsoluteCharIndex = -1;
  private lastObservedIsPlaying = false;
  // Mientras vale, no se guarda progreso: el instante de reproducción en
  // silencio de restoreSession no debe mover la posición guardada.
  private suppressPersistUntil = 0;
  // Parar solo: por reloj (temporizador de sueño) o al llegar a una posición
  // (fin del capítulo). Vive ACÁ y no en el lector porque con la pantalla
  // apagada Android congela los timers de JavaScript, y el temporizador no
  // paraba nada hasta volver a prender la pantalla; los avisos del reproductor
  // sí siguen llegando en segundo plano.
  private stopAtTime: number | null = null;
  private stopAtChar: number | null = null;
  // El usuario ya pidió sonido en este proceso: la restauración del arranque
  // no tiene que meterse.
  private hasUserPlayed = false;
  // Restaurando la escucha al arrancar: los avisos del reproductor no se
  // publican (nada de "Preparando" ni de posiciones a medias en pantalla).
  private isRestoring = false;
  // Foco de audio pedido para esta tanda de sonido. El play desde la
  // notificación, la pantalla de bloqueo o el auricular va directo al
  // reproductor nativo SIN pedir foco (expo-audio sólo lo pide en el play de
  // JavaScript): sonaba encima de la música de otra app y una llamada no lo
  // pausaba. Un play() de JavaScript, idempotente, lo pide.
  private focusClaimedWhilePlaying = false;
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
    this.activeVoiceId = null;
    this.activeLanguage = null;
    this.activeMetadata = undefined;
    this.lastPersistedAt = 0;
    this.lastPersistedAbsoluteCharIndex = -1;
    this.advancingPromise = null;
    this.chunkPreparationPromises.clear();
  }

  private getChunkIndexForAbsoluteChar(absoluteCharIndex: number) {
    if (this.activeChunks.length === 0) return 0;
    const safe = clamp(absoluteCharIndex, 0, this.activeDocument?.fullText.length ?? 0);
    return Math.max(chunkIndexForChar(this.activeChunks, safe), 0);
  }

  /**
   * Grilla de tramos anclada donde arranca la escucha: el primer tramo es corto
   * para que suene enseguida. Se re-ancla solo cuando el usuario pide un punto
   * fuera del tramo activo; el avance natural entre tramos conserva la grilla.
   */
  private ensureChunksFor(document: ParsedDocument, absoluteCharIndex: number, reanchor: boolean) {
    if (this.sentencesDocId !== document.id || this.sentencesLen !== document.fullText.length) {
      this.sentences = buildSentenceSpans(document.fullText);
      this.sentencesDocId = document.id;
      this.sentencesLen = document.fullText.length;
      // El índice apunta a la grilla vieja: sin resetearlo queda fuera de rango
      // y lo que se publica (tramo actual, si es el último) pasa a ser mentira.
      this.activeChunks = [];
      this.activeChunkIndex = 0;
    }
    if (this.activeChunks.length === 0) {
      this.activeChunks = buildAnchoredChunks(this.sentences, absoluteCharIndex);
      return;
    }
    if (!reanchor) return;
    const current = this.activeChunks[this.activeChunkIndex];
    const insideCurrent = current && absoluteCharIndex >= current.startChar && absoluteCharIndex <= current.endChar;
    if (!insideCurrent) {
      this.activeChunks = buildAnchoredChunks(this.sentences, absoluteCharIndex);
    }
  }

  private handlePlayerStatus = (status: AudioStatus) => {
    if (this.isRestoring) return;
    this.trackListening(Boolean(status.playing));
    const activeChunk = this.getActiveChunk();
    if (status.playing && !this.focusClaimedWhilePlaying) {
      this.focusClaimedWhilePlaying = true;
      try {
        this.player?.play();
      } catch {
        // sin foco se sigue igual
      }
    }
    if (!status.playing) this.focusClaimedWhilePlaying = false;
    // Parar solo: por reloj o por posición. La pausa guarda la posición.
    if (status.playing && activeChunk && status.duration) {
      const at = activeChunk.startChar + Math.round((status.currentTime / status.duration) * getChunkLength(activeChunk));
      const byTime = this.stopAtTime !== null && Date.now() >= this.stopAtTime;
      const byChar = this.stopAtChar !== null && at >= this.stopAtChar;
      if (byTime || byChar) {
        this.stopAtTime = null;
        this.stopAtChar = null;
        void this.pause();
        return;
      }
    }
    // Sin tramo activo no se sabe dónde está la lectura: "terminó el último"
    // con la grilla vacía daba true (0 >= -1) y marcaba el libro como leído.
    const isLastChunk = Boolean(activeChunk) && this.activeChunkIndex >= this.activeChunks.length - 1;
    const didFinishDocument = Boolean(status.didJustFinish && isLastChunk);
    // Libro terminado: ya no hay escucha que restaurar en el próximo arranque.
    if (didFinishDocument) void runtimeStateRepository.setAudioSessionBookId(null).catch(() => {});

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
      // Invariante: si YA está sonando, no puede seguir "preparando". Cierra de
      // raíz todos los caminos donde isPreparing quedaba pegado (prefetch en
      // vuelo reusado, guard de advancingPromise) y congelaba el FAB en "…".
      ...(status.playing ? { isPreparing: false } : null),
    });

    // Forzamos persistencia solo al terminar o en la TRANSICIÓN a pausa,
    // no en cada tick de status mientras está pausado (escribiría SQLite cada 250 ms).
    const justPaused = this.lastObservedIsPlaying && !status.playing;
    this.lastObservedIsPlaying = status.playing;
    // Guardar corre cada 250 ms mientras suena: un SQLite ocupado no debe
    // convertirse en una lluvia de rechazos sin atrapar.
    void this.persistProgressFromStatus(status, status.didJustFinish || justPaused).catch(() => {});

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
    // Sobre el provisorio de un PDF no hay progreso que valga: sus offsets no
    // son los del libro y pisarían la posición real guardada.
    if (doc.pdf?.textPending) return;
    if (Date.now() < this.suppressPersistUntil) return;

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

    const footprint = progressFootprint(doc, pos.absoluteCharIndex);
    await bookProgressRepository.saveProgress({
      bookId: doc.id,
      chapterId: null, // chapterRepository.getChapterAtChar puede enriquecer esto async
      blockIndex: pos.blockIndex,
      charIndex: pos.charIndex,
      ...footprint,
      percentage: doc.pdf && footprint.page !== null ? pagePercentage(footprint.page, doc.pdf.pageCount) : pos.percentage,
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

  /**
   * Voz para este libro: la elegida en Ajustes si es del idioma del libro; si
   * no, la mejor voz instalada de ese idioma.
   */
  private async resolveVoiceFor(document: ParsedDocument, preferredVoiceId: string | null) {
    let language = this.languageByDocument.get(document.id);
    if (language === undefined) {
      language = detectLanguage(document.fullText);
      this.languageByDocument.set(document.id, language);
    }
    const voices = await listVoices().catch(() => []);
    return resolveVoice(voices, preferredVoiceId, language);
  }

  /** Sintetiza un tramo con el motor TTS del sistema y cachea el WAV. */
  private async prepareChunk(
    document: ParsedDocument,
    chunk: SynthesisChunk,
    voiceId: string | null,
    sessionId: number,
    silent = false,
  ): Promise<string | null> {
    const chunkId = this.chunkIdFor(document, chunk, voiceId);
    const existing = this.chunkPreparationPromises.get(chunkId);
    if (existing) return existing;

    if (!silent) {
      this.updateSnapshot({ documentId: document.id, voiceId, isPreparing: true, preparationProgress: 0, errorMessage: null });
    }

    // Texto ORIGINAL del tramo (no reconstruido): así fluye natural, con las
    // pausas sólo en los párrafos reales. Reconstruir uniendo oraciones con "\n\n"
    // hacía que fal pausara entre cada oración (y a mitad de oraciones largas
    // partidas) → sonaba cortado "como si hubiera un punto". El texto ya viene
    // limpio y normalizado del parser.
    const rawText = this.spokenTextFor(document, chunk);
    const promise = synthesizeSpeech(chunkId, rawText, voiceId, this.activeLanguage)
      .then((mp3Uri) => {
        // SIEMPRE devolvemos el uri: esta promesa puede estar cacheada y ser
        // esperada por una sesión distinta a la que la creó. Solo la UI
        // (updateSnapshot) se gatea por sesión; el dato fluye a quien lo espera.
        // Antes devolvía null si cambió la sesión → el nuevo play/seek recibía
        // null y el player quedaba mudo (carrera de sesión).
        if (!silent && this.isSessionActive(sessionId)) {
          this.updateSnapshot({ sourceUri: mp3Uri, isPreparing: false, preparationProgress: 1 });
        }
        return mp3Uri;
      })
      .catch((error) => {
        // SIEMPRE re-lanzamos: quien espera la promesa (aunque sea otra sesión)
        // debe ver el error, no una resolución null silenciosa.
        const rawMessage = error instanceof Error ? error.message : 'No se pudo preparar el audio.';
        if (!silent && this.isSessionActive(sessionId)) {
          this.updateSnapshot({ isPreparing: false, errorMessage: rawMessage });
        }
        throw error;
      })
      .finally(() => {
        this.chunkPreparationPromises.delete(chunkId);
        if (!silent && this.isSessionActive(sessionId)) this.updateSnapshot({ isPreparing: false });
      });

    this.chunkPreparationPromises.set(chunkId, promise);
    return promise;
  }

  private async prefetchNextChunk(document: ParsedDocument, voiceId: string | null, chunkIndex: number, sessionId: number) {
    // En orden: el motor sintetiza de a uno, y el más cercano es el que urge.
    for (let offset = 1; offset <= PREFETCH_DEPTH; offset++) {
      if (!this.isSessionActive(sessionId)) return;
      const nextChunk = this.activeChunks[chunkIndex + offset];
      if (!nextChunk) return;
      try { await this.prepareChunk(document, nextChunk, voiceId, sessionId, true); } catch { return; }
    }
  }

  private async ensureChunkLoaded(
    document: ParsedDocument,
    voiceId: string | null,
    absoluteCharIndex: number,
    sessionId: number,
    targetIndexOverride?: number,
  ) {
    await audioSessionService.ensureReady();
    if (!this.isSessionActive(sessionId)) return null;

    // Si el documento cambió (u otro texto con el mismo id: el provisorio de un
    // PDF vs. el definitivo), las oraciones y los tramos se rehacen.
    if (this.activeDocument?.id !== document.id) {
      this.activeChunks = [];
      this.activeChunkIndex = 0;
    }
    this.activeDocument = document;
    this.ensureChunksFor(document, absoluteCharIndex, targetIndexOverride === undefined);

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

    // Play/seek del usuario lejos de lo que se estaba preparando: se descarta la
    // cola del motor para que el tramo pedido no espere detrás de prefetch viejos.
    // (En el avance natural NO: ahí lo que está en vuelo es justo lo que sigue.)
    if (targetIndexOverride === undefined && this.chunkPreparationPromises.size > 0) {
      const targetId = this.chunkIdFor(document, targetChunk, voiceId);
      if (!this.chunkPreparationPromises.has(targetId)) {
        this.chunkPreparationPromises.clear();
        await cancelPendingSynthesis();
        if (!this.isSessionActive(sessionId)) return null;
      }
    }

    const mp3Uri = await this.prepareChunk(document, targetChunk, voiceId, sessionId);

    if (!mp3Uri || !this.isSessionActive(sessionId)) return null;

    // Por rango, no por número de tramo: tras re-anclar la grilla, el tramo 3 puede
    // ser otro texto y el player tiene que cargar el archivo nuevo.
    const sourceKey = this.chunkIdFor(document, targetChunk, voiceId);

    if (this.activeSourceKey !== sourceKey) {
      this.lastPersistedAt = 0;
      this.lastPersistedAbsoluteCharIndex = -1;
      if (player.currentStatus.playing) player.pause();
      player.replace({ uri: mp3Uri, name: `${document.fileName} · ${targetChunk.index + 1}/${this.activeChunks.length}` });
      this.activeSourceKey = sourceKey;
      this.activeChunkIndex = targetIndex;
      await this.waitUntilLoaded(player, sessionId);
    } else if (!player.currentStatus.isLoaded) {
      // El índice también acá: el mismo RANGO puede ser el tramo 2 ahora y el 5
      // después de re-anclar la grilla. Si no se actualiza, el avance al tramo
      // siguiente salta al equivocado.
      this.activeChunkIndex = targetIndex;
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
    // Si ya hay un avance en curso, o no hay documento, salimos — pero soltando
    // el "Preparando…" que el caller (p.ej. seekBy) pudo haber seteado, para que
    // el FAB no quede congelado en "…".
    if (this.advancingPromise || !this.activeDocument) {
      // El avance en curso es dueño del estado; soltamos cualquier "Preparando…"
      // que un caller (p.ej. seekBy) haya seteado, aunque isPlaying sea false.
      if (this.snapshot.isPreparing) this.updateSnapshot({ isPreparing: false });
      return;
    }
    const nextChunk = this.activeChunks[this.activeChunkIndex + 1];
    if (!nextChunk) {
      // Sin tramo siguiente: no dejar el "Preparando…" pegado.
      this.updateSnapshot({ isPreparing: false });
      return;
    }

    const doc = this.activeDocument;
    const voiceId = this.activeVoiceId;
    const metadata = this.activeMetadata;
    const sessionId = this.playbackSessionId;
    const expectedIndex = this.activeChunkIndex;
    const pauseGeneration = this.pauseGeneration;

    const task = (async () => {
      if (!this.isSessionActive(sessionId) || this.activeChunkIndex !== expectedIndex) {
        // Otro flujo tomó el control: soltar el estado de "preparando".
        if (this.isSessionActive(sessionId)) this.updateSnapshot({ isPreparing: false });
        return;
      }
      const loaded = await this.ensureChunkLoaded(doc, voiceId, nextChunk.startChar, sessionId, expectedIndex + 1);
      if (!loaded || !this.isSessionActive(sessionId) || !this.player) return;
      // Rate VIVO (no el capturado): si cambió la velocidad durante el avance,
      // no queremos revertirla al valor viejo.
      this.player.setPlaybackRate(this.activePlaybackRate);
      this.player.setActiveForLockScreen(true, metadata ?? { title: doc.fileName, artist: 'Bardo' });
      await this.player.seekTo(0);
      if (!this.isSessionActive(sessionId)) return;
      // Pausaste mientras se preparaba este tramo: queda cargado y en el punto
      // justo, pero no suena hasta que toques play de nuevo.
      if (this.pauseGeneration !== pauseGeneration) {
        this.updateSnapshot({ isPlaying: false, isPreparing: false });
        return;
      }
      // El temporizador de sueño venció mientras se preparaba este tramo.
      if (this.stopAtTime !== null && Date.now() >= this.stopAtTime) {
        this.stopAtTime = null;
        this.stopAtChar = null;
        this.updateSnapshot({ isPlaying: false, isPreparing: false });
        return;
      }
      this.focusClaimedWhilePlaying = true;
      this.player.play();
    })();

    // OJO: lo que se guarda es la promesa ENCADENADA, y es contra ESA que hay que
    // comparar al liberar. Antes se comparaba contra `task`, que nunca es igual:
    // la guarda no se soltaba jamás y, después del primer cambio de tramo, todos
    // los siguientes se descartaban en silencio (la voz se cortaba sola).
    const guarded: Promise<void> = task
      .catch((err) => {
        if (!this.isSessionActive(sessionId)) return;
        // isPreparing:false también acá: un avance fallido no debe dejar el FAB en "…".
        this.updateSnapshot({ isPlaying: false, isPreparing: false, errorMessage: err instanceof Error ? err.message : 'No se pudo continuar el audio.' });
      })
      .finally(() => { if (this.advancingPromise === guarded) this.advancingPromise = null; });

    this.advancingPromise = guarded;
    await guarded;
  }

  private async seekWithinActiveChunk(absoluteCharIndex: number) {
    const player = this.ensurePlayer();
    const chunk = this.getActiveChunk();
    const duration = player.currentStatus.duration || this.snapshot.duration;
    if (!chunk || !duration) return;
    const safe = clamp(absoluteCharIndex, chunk.startChar, chunk.endChar);
    const seconds = ((safe - chunk.startChar) / getChunkLength(chunk)) * duration;
    // Caer EXACTO en el final deja el player "terminado sin evento" y no suena
    // nada (pasa al retomar un libro que se había escuchado hasta el final).
    await player.seekTo(Math.min(seconds, Math.max(0, duration - 0.75)));
  }

  /**
   * Registra (o vuelve a registrar) los controles de la notificación y la
   * pantalla de bloqueo. Nunca tira: si el servicio nativo está en un estado
   * raro, la voz tiene que sonar igual.
   */
  private armLockScreen(metadata?: AudioMetadata) {
    try {
      this.player?.setActiveForLockScreen(
        true,
        metadata ?? this.activeMetadata ?? { title: this.activeDocument?.fileName ?? 'Bardo', artist: 'Bardo' },
      );
    } catch (error) {
      console.warn('[audio] no se pudieron armar los controles de la notificación:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * ¿Empezó a sonar? Espera hasta 1,5 s a que el reproductor diga que sí. Se
   * escucha el aviso del reproductor y no un timer: con la pantalla apagada
   * los timers de JavaScript se congelan, y si el usuario bloqueaba el
   * teléfono justo después de tocar play, la espera quedaba colgada.
   */
  private startedPlaying(sessionId: number): Promise<boolean> {
    const player = this.player;
    if (!player) return Promise.resolve(false);
    if (player.currentStatus.playing) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        subscription.remove();
        resolve(value);
      };
      const subscription = player.addListener('playbackStatusUpdate', (status) => {
        // Otro pedido tomó el control: no es un fallo de este.
        if (!this.isSessionActive(sessionId) || status.playing) finish(true);
      });
      const timer = setTimeout(() => finish(Boolean(player.currentStatus.playing)), 1500);
    });
  }

  /** Tira el reproductor nativo; el próximo ensureChunkLoaded crea otro y recarga el tramo. */
  private recreatePlayer() {
    this.playerSubscription?.remove();
    this.playerSubscription = null;
    try {
      this.player?.release();
    } catch {
      // ya estaba liberado
    }
    this.player = null;
    this.activeSourceKey = null;
    this.lastObservedIsPlaying = false;
  }

  /**
   * Android manda las teclas de medios (auricular, notificación, pantalla de
   * bloqueo) a la última sesión que REPRODUJO: una sesión recién armada en
   * pausa no las recibe (verificado con `input keyevent 126`: nada hasta que
   * el libro suena una vez). Un instante de reproducción en silencio la deja
   * como "la sesión de los botones", y se vuelve a la posición exacta sin
   * guardar nada en el medio.
   */
  private async claimMediaButtons(absoluteCharIndex: number, sessionId: number) {
    const player = this.player;
    if (!player || !player.currentStatus.isLoaded || !this.isSessionActive(sessionId)) return;
    const volume = player.volume;
    try {
      player.volume = 0;
      this.focusClaimedWhilePlaying = true;
      player.play();
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Si en el medio el usuario pidió sonido, es SU reproducción: no se pausa.
      if (!this.isSessionActive(sessionId)) return;
      player.pause();
      await this.seekWithinActiveChunk(absoluteCharIndex);
    } catch (error) {
      console.warn('[audio] no se pudieron reclamar los botones de medios:', error instanceof Error ? error.message : error);
    } finally {
      player.volume = volume;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  subscribe(listener: PlaybackListener) {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot() { return { ...this.snapshot }; }

  /**
   * Vuelve a dejar un libro cargado EN PAUSA en su posición, con la sesión de
   * medios armada, después de que la app se reinició mientras se lo escuchaba.
   * No suena nada: queda todo listo para que el play de la notificación, de la
   * pantalla de bloqueo, del auricular o de la tarjeta del Inicio funcione.
   * Si ya hay un libro cargado, no hace nada.
   */
  async restoreSession(
    document: ParsedDocument,
    blockIndex: number,
    charIndex: number,
    voiceId: string | null,
    rate: number,
    metadata?: AudioMetadata,
  ) {
    if (this.activeDocument || this.hasUserPlayed) return;
    const absolute = getAbsoluteCharIndex(document, blockIndex, charIndex);
    this.isRestoring = true;
    // Nada de lo que pase acá adentro se guarda como progreso: la base ya
    // tiene la posición exacta, y el primer aviso tras cargar el tramo
    // apuntaba al principio de la oración.
    this.suppressPersistUntil = Date.now() + 20000;
    try {
      // Primero el WAV, en silencio y sin tocar la sesión (sin "Preparando…"
      // ni "Error de voz" en pantalla al arrancar): si la voz no está o el
      // motor falla, no se restaura y listo.
      const ready = await this.prewarm(document, voiceId, blockIndex, charIndex);
      if (!ready || this.hasUserPlayed || this.activeDocument) return;
      const sessionId = this.startPlaybackSession();
      this.activePlaybackRate = rate;
      this.activeMetadata = metadata;
      this.preferredVoiceId = voiceId;
      const resolved = await this.resolveVoiceFor(document, voiceId);
      // Si el usuario pidió sonido mientras tanto, es su sesión: no se toca.
      if (!this.isSessionActive(sessionId) || this.hasUserPlayed) return;
      this.activeVoiceId = resolved.voiceId;
      this.activeLanguage = resolved.language;
      const loaded = await this.ensureChunkLoaded(document, resolved.voiceId, absolute, sessionId).catch(() => null);
      if (!loaded || !this.isSessionActive(sessionId) || this.hasUserPlayed || !this.player) return;
      await this.seekWithinActiveChunk(absolute);
      this.player.pause();
      this.player.setPlaybackRate(rate);
      this.armLockScreen(metadata);
      // Los botones de medios sólo si no hay otra app sonando: si la hay, el
      // play del auricular es de ella, no nuestro.
      if (!isMusicActive()) await this.claimMediaButtons(absolute, sessionId);
    } catch (error) {
      console.warn('[audio] no se pudo restaurar la escucha:', error instanceof Error ? error.message : error);
    } finally {
      this.isRestoring = false;
      this.suppressPersistUntil = Date.now() + 1000;
      // Recién ahora el resto se entera: cargado, en pausa, en su posición.
      if (this.player && this.snapshot.documentId === document.id) this.handlePlayerStatus(this.player.currentStatus);
    }
  }

  /** ¿Se está restaurando la escucha del arranque? Mientras tanto no se publica nada. */
  isRestoringSession(): boolean {
    return this.isRestoring;
  }

  /** Parar solo cuando el reloj llegue a `time` (ms desde época); null lo cancela. */
  setStopAt(time: number | null) {
    this.stopAtTime = time;
  }

  /** Parar solo al llegar a esta posición del texto (fin del capítulo); null lo cancela. */
  setStopAtChar(char: number | null) {
    this.stopAtChar = char;
  }

  /** Reanuda el libro cargado (en pausa) desde donde está: el play de la tarjeta del Inicio. */
  async resume() {
    const doc = this.activeDocument;
    if (!doc || !this.player || !this.player.currentStatus.isLoaded) return;
    const at = this.currentAbsoluteCharFor(doc.id);
    const sessionId = this.startPlaybackSession();
    this.pauseGeneration += 1;
    this.hasUserPlayed = true;
    this.armLockScreen(this.activeMetadata ?? { title: doc.fileName, artist: 'Bardo' });
    this.player.setPlaybackRate(this.activePlaybackRate);
    this.focusClaimedWhilePlaying = true;
    this.player.play();
    if (await this.startedPlaying(sessionId)) return;
    if (!this.isSessionActive(sessionId)) return;
    // El nativo no arrancó: el camino completo de play() lo recrea y reintenta.
    this.recreatePlayer();
    await this.play(doc, this.preferredVoiceId, this.activePlaybackRate, at ?? 0, this.activeMetadata);
  }

  /**
   * Al volver a la app, si hay un libro cargado se vuelven a registrar los
   * controles: si Android mató el servicio de la notificación (o el usuario
   * la cerró), la sesión de medios vuelve sin que haya que tocar nada.
   */
  rearmLockScreen() {
    if (!this.activeDocument || !this.player?.currentStatus.isLoaded) return;
    this.armLockScreen(this.activeMetadata);
  }

  /**
   * Dónde va el audio de ESTE libro ahora (sonando o en pausa), en caracteres
   * del texto que el servicio tiene; null si no es el libro cargado. Lo usa el
   * lector cuando llega el texto real de un PDF: si la voz ya lo estaba
   * leyendo, esa es la posición buena, no la del progreso guardado.
   */
  currentAbsoluteCharFor(documentId: string): number | null {
    const doc = this.activeDocument;
    const chunk = this.getActiveChunk();
    const status = this.player?.currentStatus;
    if (!doc || doc.id !== documentId || !chunk || !status?.isLoaded || !status.duration) return null;
    return clamp(
      chunk.startChar + Math.round((status.currentTime / status.duration) * getChunkLength(chunk)),
      chunk.startChar,
      chunk.endChar,
    );
  }

  async play(document: ParsedDocument, voiceId: string | null, rate: number, absoluteCharIndex: number, metadata?: AudioMetadata) {
    const sessionId = this.startPlaybackSession();
    this.pauseGeneration += 1; // pedir sonido cancela cualquier pausa anterior
    this.hasUserPlayed = true;
    this.activePlaybackRate = rate;
    this.activeMetadata = metadata;
    this.preferredVoiceId = voiceId;
    // Señal de vida YA: resolver la voz puede tardar segundos en frío (el motor
    // de texto a voz arranca), y sin esto el botón no mostraba nada y parecía
    // roto; el usuario lo tocaba de nuevo y el segundo toque se descartaba.
    this.updateSnapshot({ documentId: document.id, isPreparing: true, errorMessage: null });
    // Se anota qué libro se escucha: si la app se cierra, el próximo arranque
    // lo vuelve a dejar cargado en pausa con la sesión de medios armada.
    void runtimeStateRepository.setAudioSessionBookId(document.id).catch(() => {});

    const resolved = await this.resolveVoiceFor(document, voiceId);
    if (!this.isSessionActive(sessionId)) return;
    this.activeVoiceId = resolved.voiceId;
    this.activeLanguage = resolved.language;

    let loaded: SynthesisChunk | null;
    try {
      loaded = await this.ensureChunkLoaded(document, resolved.voiceId, absoluteCharIndex, sessionId);
    } catch (error) {
      // Una sesión reemplazada por otro play/seek no debe mostrar su error.
      if (!this.isSessionActive(sessionId)) return;
      this.updateSnapshot({ isPreparing: false });
      throw error;
    }
    // Si el tramo no cargó (síntesis falló / sesión cambió), NO seguimos a
    // player.play() sobre un player sin fuente (silencio o tramo viejo).
    if (!loaded || !this.isSessionActive(sessionId) || !this.player) return;

    await audioSessionService.ensureNotificationPermission();
    if (!this.isSessionActive(sessionId) || !this.player) return;

    this.player.setPlaybackRate(rate);
    this.armLockScreen(metadata ?? { title: document.fileName, artist: 'Bardo' });
    await this.seekWithinActiveChunk(absoluteCharIndex);
    if (!this.isSessionActive(sessionId)) return;
    this.focusClaimedWhilePlaying = true;
    this.player.play();
    // Si el reproductor no arranca (el nativo quedó inutilizable después de que
    // Android matara el servicio de la notificación, o el proceso volvió de un
    // cierre raro), se recrea y se intenta UNA vez más, en vez de dejar al
    // usuario tocando play sin que pase nada.
    if (await this.startedPlaying(sessionId)) return;
    if (!this.isSessionActive(sessionId)) return;
    console.warn('[audio] el reproductor no arrancó: se recrea y se reintenta');
    this.recreatePlayer();
    loaded = await this.ensureChunkLoaded(document, resolved.voiceId, absoluteCharIndex, sessionId).catch(() => null);
    if (!loaded || !this.isSessionActive(sessionId) || !this.player) return;
    this.player.setPlaybackRate(rate);
    this.armLockScreen(metadata ?? { title: document.fileName, artist: 'Bardo' });
    await this.seekWithinActiveChunk(absoluteCharIndex);
    if (!this.isSessionActive(sessionId)) return;
    this.player.play();
  }

  /**
   * Deja listo el primer tramo desde una posición SIN reproducir nada: se llama al
   * abrir el libro, así el play suena al instante. No toca la sesión activa: si
   * hay algo sonando (este u otro libro) no hace nada.
   */
  async prewarm(document: ParsedDocument, voiceId: string | null, blockIndex: number, charIndex: number): Promise<boolean> {
    if (this.snapshot.isPlaying || this.snapshot.isPreparing) return false;
    // Otro libro cargado (en pausa): no se le pisa el idioma ni la grilla.
    if (this.activeDocument && this.activeDocument.id !== document.id) return false;
    try {
      const absoluteCharIndex = getAbsoluteCharIndex(document, blockIndex, charIndex);
      if (this.sentencesDocId !== document.id || this.sentencesLen !== document.fullText.length) {
        this.sentences = buildSentenceSpans(document.fullText);
        this.sentencesDocId = document.id;
        this.sentencesLen = document.fullText.length;
        this.activeChunks = [];
        this.activeChunkIndex = 0;
      }
      // La misma grilla que va a usar play() desde acá: el tramo queda cacheado por rango.
      const chunks = buildAnchoredChunks(this.sentences, absoluteCharIndex);
      const index = chunkIndexForChar(chunks, absoluteCharIndex);
      const chunk = chunks[index];
      if (!chunk) return false;
      const resolved = await this.resolveVoiceFor(document, voiceId);
      if (this.snapshot.isPlaying || this.snapshot.isPreparing) return false;
      this.activeLanguage = resolved.language;
      const uri = await this.prepareChunk(document, chunk, resolved.voiceId, this.playbackSessionId, true);
      return Boolean(uri);
    } catch {
      // Precalentar es opcional: si falla, play() lo sintetiza como siempre.
      return false;
    }
  }

  async pause() {
    this.pauseGeneration += 1; // corta un avance de tramo en vuelo
    // Y también un play() en vuelo: si el temporizador de sueño paraba mientras
    // un tramo se sintetizaba, ese play terminaba y arrancaba el sonido igual.
    // Con la sesión invalidada, ese play se retira antes de sonar.
    this.playbackSessionId += 1;
    if (!this.player) {
      this.updateSnapshot({ isPlaying: false, isPreparing: false });
      return;
    }
    this.player.pause();
    this.updateSnapshot({ isPlaying: false, isPreparing: false });
    await this.persistProgressFromStatus(this.player.currentStatus, true);
  }

  async seekToBlock(document: ParsedDocument, blockIndex: number, charIndex: number, autoplay: boolean, voiceId: string | null, rate: number, metadata?: AudioMetadata) {
    const absoluteCharIndex = getAbsoluteCharIndex(document, blockIndex, charIndex);
    if (autoplay) { await this.play(document, voiceId, rate, absoluteCharIndex, metadata); return; }
    const sessionId = this.startPlaybackSession();
    this.preferredVoiceId = voiceId;
    const resolved = await this.resolveVoiceFor(document, voiceId);
    if (!this.isSessionActive(sessionId)) return;
    this.activeVoiceId = resolved.voiceId;
    this.activeLanguage = resolved.language;
    let loaded: SynthesisChunk | null;
    try {
      loaded = await this.ensureChunkLoaded(document, resolved.voiceId, absoluteCharIndex, sessionId);
    } catch (error) {
      if (!this.isSessionActive(sessionId)) return;
      throw error;
    }
    if (!loaded || !this.isSessionActive(sessionId)) return;
    await this.seekWithinActiveChunk(absoluteCharIndex);
    this.player?.pause();
  }

  setPlaybackRate(rate: number) {
    this.activePlaybackRate = rate;
    if (this.player) this.player.setPlaybackRate(rate);
  }

  /** Cambia la voz elegida (null = automática). El tramo actual sigue con la voz
   *  vieja hasta el próximo seek/play; los que se preparen desde ahora usan la nueva. */
  setVoice(voiceId: string | null) {
    this.preferredVoiceId = voiceId;
    const doc = this.activeDocument;
    if (!doc) return;
    void this.resolveVoiceFor(doc, voiceId).catch(() => null).then((resolved) => {
      if (!resolved || this.activeDocument !== doc || this.preferredVoiceId !== voiceId) return;
      this.activeVoiceId = resolved.voiceId;
      this.activeLanguage = resolved.language;
    });
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

    // Retroceder más allá del principio del tramo: se carga el anterior y se sigue
    // desde su final. Con tramos cortos (el primero dura ~10 s), sin esto "15 s
    // atrás" solo reiniciaba el tramo actual.
    if (deltaSeconds < 0 && target < 0 && this.activeChunkIndex > 0 && this.activeDocument && !this.advancingPromise) {
      const doc = this.activeDocument;
      const previous = this.activeChunks[this.activeChunkIndex - 1];
      // La grilla pudo rehacerse (otro libro, texto re-extraído) mientras el
      // índice seguía apuntando a la vieja: sin tramo anterior no hay nada que cargar.
      if (!previous) {
        await this.player.seekTo(0);
        return;
      }
      const sessionId = this.playbackSessionId;
      const wasPlaying = status.playing;
      const remaining = -target; // segundos que faltan retroceder dentro del tramo anterior
      this.updateSnapshot({ isPreparing: true });
      try {
        const loaded = await this.ensureChunkLoaded(doc, this.activeVoiceId, previous.startChar, sessionId, this.activeChunkIndex - 1);
        if (!loaded || !this.isSessionActive(sessionId) || !this.player) return;
        const previousDuration = this.player.currentStatus.duration || 0;
        await this.player.seekTo(Math.max(0, previousDuration - remaining));
        if (wasPlaying) this.player.play();
      } finally {
        if (this.isSessionActive(sessionId)) this.updateSnapshot({ isPreparing: false });
      }
      return;
    }

    await this.player.seekTo(Math.max(0, Math.min(duration > 0 ? duration - 0.25 : target, target)));
  }

  async stopAndUnload() {
    // Lo escuchado hasta acá, antes de soltar el reproductor.
    this.flushListening();
    let capturedError: unknown = null;
    try {
      if (this.player) {
        this.player.setActiveForLockScreen(false);
        // Se guarda la posición SÓLO si estaba sonando. En pausa, el punto de
        // pausa ya se guardó en su momento y el usuario pudo haber seguido
        // leyendo a mano: volver a escribir la posición vieja del audio pisaba
        // esa lectura ("Detener la voz" desde el Inicio te devolvía a donde
        // habías pausado).
        if (this.player.currentStatus.playing) {
          await this.player.pause();
          await this.persistProgressFromStatus(this.player.currentStatus, true);
        }
      }
    } catch (e) { capturedError = e; }
    finally {
      try { this.unload(); } catch (e) { if (!capturedError) capturedError = e; }
    }
    if (capturedError) throw capturedError;
  }

  unload() {
    this.playbackSessionId += 1;
    this.stopAtTime = null;
    this.stopAtChar = null;
    // Parar del todo: ya no hay escucha que restaurar en el próximo arranque.
    void runtimeStateRepository.setAudioSessionBookId(null).catch(() => {});
    this.playerSubscription?.remove();
    this.playerSubscription = null;
    this.player?.release();
    this.player = null;
    this.resetPlaybackState();
    this.emit();
  }
}

export const documentAudioPlaybackService = new DocumentAudioPlaybackService();

// Al volver a la app (desde la pantalla de bloqueo, otra app, o después de que
// el usuario cerrara la notificación), los controles se vuelven a registrar si
// hay un libro cargado: si Android había matado el servicio de la notificación,
// la sesión de medios vuelve sin que haya que tocar nada.
AppState.addEventListener('change', (state) => {
  if (state === 'active') documentAudioPlaybackService.rearmLockScreen();
});
export type DocumentPlaybackSnapshot = PlaybackSnapshot;
