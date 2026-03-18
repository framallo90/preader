import * as Speech from 'expo-speech';
import { Voice } from 'expo-speech';

import { TextBlock } from '../types/document';
import { audioSessionService } from './audioSessionService';

type SpeechBoundaryEvent = {
  charIndex: number;
  charLength: number;
};

type SpeakBlockOptions = {
  startCharIndex?: number;
  rate: number;
  voiceId: string | null;
  onStart?: () => void;
  onBoundary?: (event: SpeechBoundaryEvent) => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

class SpeechService {
  private activeRequestId = 0;

  private normalizeError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message.trim()) {
      return error;
    }

    return new Error(fallback);
  }

  async getVoices() {
    return Speech.getAvailableVoicesAsync();
  }

  async isSpeaking() {
    return Speech.isSpeakingAsync();
  }

  async stop() {
    this.activeRequestId += 1;

    try {
      await Speech.stop();
    } catch {
      // El motor TTS puede quedar inestable al volver del fondo.
      // Un error al limpiar no deberia tirar abajo la app.
    }
  }

  async speakBlock(block: TextBlock, options: SpeakBlockOptions) {
    const nextRequestId = this.activeRequestId + 1;
    const startCharIndex = Math.max(0, Math.min(options.startCharIndex ?? 0, block.text.length));
    const text = block.text.slice(startCharIndex);

    this.activeRequestId = nextRequestId;

    if (!text.trim()) {
      options.onDone?.();
      return;
    }

    try {
      await audioSessionService.ensureReady();
      try {
        await Speech.stop();
      } catch {
        // Si no habia una locucion activa o el motor esta inestable, seguimos.
      }

      Speech.speak(text, {
        rate: options.rate,
        voice: options.voiceId ?? undefined,
        onStart: () => {
          if (this.activeRequestId !== nextRequestId) {
            return;
          }

          options.onStart?.();
        },
        onBoundary: (event: unknown) => {
          if (
            this.activeRequestId !== nextRequestId ||
            !event ||
            typeof event !== 'object' ||
            !('charIndex' in event) ||
            !('charLength' in event)
          ) {
            return;
          }

          options.onBoundary?.({
            charIndex: Number(event.charIndex),
            charLength: Number(event.charLength),
          });
        },
        onDone: () => {
          if (this.activeRequestId !== nextRequestId) {
            return;
          }

          options.onDone?.();
        },
        onStopped: () => {
          if (this.activeRequestId !== nextRequestId) {
            return;
          }

          options.onStopped?.();
        },
        onError: (error) => {
          if (this.activeRequestId !== nextRequestId) {
            return;
          }

          options.onError?.(this.normalizeError(error, 'La lectura en voz alta fallo.'));
        },
      });
    } catch (error) {
      options.onError?.(this.normalizeError(error, 'No se pudo iniciar el motor de voz.'));
    }
  }
}

export const speechService = new SpeechService();
export type SpeechVoice = Voice;
