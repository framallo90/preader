import {
  getVoiceSynthesizerModule,
  NativeVoice,
  SynthesizedDocumentAudio,
  SynthesisProgressPayload,
} from '../../modules/voice-synthesizer';
import { ParsedDocument } from '../types/document';
import { SynthesisChunk, buildSynthesisChunks } from '../utils/synthesisSegments';

type Subscription = {
  remove: () => void;
};

const SYNTHESIS_CACHE_VERSION = 'pcm-v3';

function buildVoiceCacheKey(voiceId: string | null) {
  return `${SYNTHESIS_CACHE_VERSION}-${voiceId ?? 'system'}`;
}

function buildChunkDocumentKey(documentId: string, chunkIndex: number) {
  return `${documentId}--chunk-${chunkIndex}`;
}

function filterAvailableVoices(voices: NativeVoice[]) {
  const deduped = new Map<string, NativeVoice>();

  voices.forEach((voice) => {
    if (voice.notInstalled || voice.networkConnectionRequired) {
      return;
    }

    if (!deduped.has(voice.identifier)) {
      deduped.set(voice.identifier, voice);
    }
  });

  return [...deduped.values()];
}

class VoiceSynthesizerService {
  private voicesPromise: Promise<NativeVoice[]> | null = null;
  private chunkCache = new Map<string, SynthesisChunk[]>();

  async getVoices() {
    if (!this.voicesPromise) {
      this.voicesPromise = getVoiceSynthesizerModule()
        .getVoicesAsync()
        .then((voices) => filterAvailableVoices(voices))
        .catch((error) => {
          this.voicesPromise = null;
          throw error;
        });
    }

    return this.voicesPromise;
  }

  subscribeToProgress(listener: (payload: SynthesisProgressPayload) => void) {
    const subscription = getVoiceSynthesizerModule().addListener(
      'synthesisProgress',
      listener,
    ) as Subscription;

    return () => {
      subscription.remove();
    };
  }

  getChunks(document: ParsedDocument) {
    const cacheKey = `${document.id}:${document.fullText.length}`;
    const cached = this.chunkCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const chunks = buildSynthesisChunks(document.fullText);
    this.chunkCache.set(cacheKey, chunks);
    return chunks;
  }

  async synthesizeChunk(document: ParsedDocument, chunk: SynthesisChunk, voiceId: string | null) {
    return getVoiceSynthesizerModule().synthesizeDocumentAsync(
      buildChunkDocumentKey(document.id, chunk.index),
      buildVoiceCacheKey(voiceId),
      chunk.segments.map((segment) => segment.text),
      voiceId,
    );
  }

  async clearDocumentAudio(documentId: string, voiceId: string | null) {
    await getVoiceSynthesizerModule().clearDocumentAudioAsync(
      documentId,
      buildVoiceCacheKey(voiceId),
    );
  }

  async clearAllDocumentAudio(documentId: string) {
    await getVoiceSynthesizerModule().clearAllDocumentAudioAsync(documentId);
  }

  getVoiceCacheKey(voiceId: string | null) {
    return buildVoiceCacheKey(voiceId);
  }

  getChunkDocumentKey(documentId: string, chunkIndex: number) {
    return buildChunkDocumentKey(documentId, chunkIndex);
  }
}

export const voiceSynthesizerService = new VoiceSynthesizerService();
export type SpeechVoice = NativeVoice;
export type DocumentAudioAsset = SynthesizedDocumentAudio;
