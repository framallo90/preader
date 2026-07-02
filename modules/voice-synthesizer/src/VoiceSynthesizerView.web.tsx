import * as React from 'react';

import { VoiceSynthesizerViewProps } from './VoiceSynthesizer.types';

export default function VoiceSynthesizerView(props: VoiceSynthesizerViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
