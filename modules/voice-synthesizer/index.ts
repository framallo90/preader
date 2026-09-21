import { NativeModule, requireNativeModule } from 'expo';

export type NativeVoice = {
  identifier: string;
  name: string;
  /** BCP 47, p. ej. "es-US". */
  language: string;
  /** Escala de Android: 100 muy baja … 300 normal … 400 alta … 500 muy alta. */
  quality: number;
  latency: number;
  networkConnectionRequired: boolean;
  notInstalled: boolean;
};

export type VoiceEngineInfo = {
  engine: string;
  maxInputLength: number;
};

declare class VoiceSynthesizerNativeModule extends NativeModule {
  getVoicesAsync(): Promise<NativeVoice[]>;
  getEngineInfoAsync(): Promise<VoiceEngineInfo>;
  synthesizeToFileAsync(
    text: string,
    voiceId: string | null,
    language: string | null,
    outputPath: string,
  ): Promise<string>;
  cancelAllAsync(): Promise<void>;
}

let cachedModule: VoiceSynthesizerNativeModule | null = null;

export function getVoiceSynthesizerModule() {
  if (!cachedModule) {
    cachedModule = requireNativeModule<VoiceSynthesizerNativeModule>('VoiceSynthesizer');
  }
  return cachedModule;
}
