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

/**
 * ¿Existe el módulo en esta plataforma? Hoy sólo hay implementación Android;
 * en iOS (o en una build sin el módulo) la app tiene que abrir igual, sin voz,
 * en vez de romperse al listar voces o al sintetizar.
 */
export function isVoiceSynthesizerAvailable(): boolean {
  try {
    getVoiceSynthesizerModule();
    return true;
  } catch {
    return false;
  }
}
