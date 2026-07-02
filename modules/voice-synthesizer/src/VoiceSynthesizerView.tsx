import { requireNativeView } from 'expo';
import * as React from 'react';

import { VoiceSynthesizerViewProps } from './VoiceSynthesizer.types';

const NativeView: React.ComponentType<VoiceSynthesizerViewProps> =
  requireNativeView('VoiceSynthesizer');

export default function VoiceSynthesizerView(props: VoiceSynthesizerViewProps) {
  return <NativeView {...props} />;
}
