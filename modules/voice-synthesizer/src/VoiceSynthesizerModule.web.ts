import { registerWebModule, NativeModule } from 'expo';

import {
  NativeVoice,
  SynthesizedDocumentAudio,
  VoiceSynthesizerModuleEvents,
} from './VoiceSynthesizer.types';

class VoiceSynthesizerModule extends NativeModule<VoiceSynthesizerModuleEvents> {
  async getVoicesAsync(): Promise<NativeVoice[]> {
    return [];
  }

  async synthesizeDocumentAsync(): Promise<SynthesizedDocumentAudio> {
    throw new Error('La sintesis nativa de documentos solo esta disponible en Android.');
  }

  async clearDocumentAudioAsync(): Promise<void> {
    return;
  }

  async clearAudioFileAsync(): Promise<void> {
    return;
  }
}

export default registerWebModule(VoiceSynthesizerModule, 'VoiceSynthesizer');
