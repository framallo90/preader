export type NativeVoice = {
  identifier: string;
  name: string;
  language: string;
  quality: number;
  latency: number;
  networkConnectionRequired: boolean;
  notInstalled: boolean;
};

export type SynthesisProgressPayload = {
  documentKey: string;
  cacheKey: string;
  completedSegments: number;
  totalSegments: number;
};

export type SynthesizedDocumentAudio = {
  fileUri: string;
  cacheKey: string;
  documentKey: string;
  segmentCount: number;
};

export type VoiceSynthesizerModuleEvents = {
  synthesisProgress: (payload: SynthesisProgressPayload) => void;
};
