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

  async getVoices() {
    return Speech.getAvailableVoicesAsync();
  }

  async isSpeaking() {
    return Speech.isSpeakingAsync();
  }

  async stop() {
    this.activeRequestId += 1;
    await Speech.stop();
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

    await audioSessionService.ensureReady();
    await Speech.stop();

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

        options.onError?.(
          error instanceof Error ? error : new Error('La lectura en voz alta falló.'),
        );
      },
    });
  }
}

export const speechService = new SpeechService();
export type SpeechVoice = Voice;
