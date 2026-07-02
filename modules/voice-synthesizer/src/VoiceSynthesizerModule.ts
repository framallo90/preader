import { NativeModule, requireNativeModule } from 'expo';

import {
  NativeVoice,
  SynthesizedDocumentAudio,
  VoiceSynthesizerModuleEvents,
} from './VoiceSynthesizer.types';

declare class VoiceSynthesizerModule extends NativeModule<VoiceSynthesizerModuleEvents> {
  getVoicesAsync(): Promise<NativeVoice[]>;
  synthesizeDocumentAsync(
    documentKey: string,
    cacheKey: string,
    segments: string[],
    voiceId: string | null,
  ): Promise<SynthesizedDocumentAudio>;
  clearDocumentAudioAsync(documentKey: string, cacheKey: string): Promise<void>;
  clearAllDocumentAudioAsync(documentKeyRoot: string): Promise<void>;
  clearAudioFileAsync(fileUri: string): Promise<void>;
}

let cachedModule: VoiceSynthesizerModule | null = null;

export function getVoiceSynthesizerModule() {
  if (!cachedModule) {
    cachedModule = requireNativeModule<VoiceSynthesizerModule>('VoiceSynthesizer');
  }

  return cachedModule;
}
