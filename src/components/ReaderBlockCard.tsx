import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { TextBlock } from '../types/document';
import { ThemeColors } from '../utils/theme';
import { WordRange } from '../utils/wordRange';

type ReaderBlockCardProps = {
  block: TextBlock;
  isActive: boolean;
  colors: ThemeColors;
  fontSize: number;
  wordRange: WordRange;
  onPress: () => void;
};

/**
 * Un bloque de texto para lectura. Sin cajas ni bordes: el texto fluye como en un
 * libro. El bloque activo se tiñe sutil (posición actual) y la palabra que suena
 * se resalta. Tocar un bloque salta la lectura a ese punto.
 */
function ReaderBlockCardBase({
  block,
  isActive,
  colors,
  fontSize,
  wordRange,
  onPress,
}: ReaderBlockCardProps) {
  const lineHeight = Math.round(fontSize * 1.68);
  const activeWord =
    isActive && wordRange
      ? {
          before: block.text.slice(0, wordRange.start),
          current: block.text.slice(wordRange.start, wordRange.end),
          after: block.text.slice(wordRange.end),
        }
      : null;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.block, isActive ? { backgroundColor: colors.readerAccent } : null]}
    >
      <Text style={[styles.text, { color: colors.text, fontSize, lineHeight }]}>
        {activeWord ? (
          <>
            {activeWord.before}
            <Text
              style={[
                styles.activeWord,
                { backgroundColor: colors.highlight, color: colors.highlightText },
              ]}
            >
              {activeWord.current}
            </Text>
            {activeWord.after}
          </>
        ) : (
          block.text
        )}
      </Text>
    </Pressable>
  );
}

/**
 * Memoizado: sin esto, cada tick del resaltado re-renderiza TODOS los bloques
 * visibles y la lista se pone lenta. Ignoramos `onPress` (cambia por render) y
 * comparamos sólo lo que afecta el dibujo. Así sólo el bloque activo se redibuja.
 */
export const ReaderBlockCard = memo(
  ReaderBlockCardBase,
  (prev, next) =>
    prev.block === next.block &&
    prev.isActive === next.isActive &&
    prev.fontSize === next.fontSize &&
    prev.colors === next.colors &&
    prev.wordRange === next.wordRange,
);

const styles = StyleSheet.create({
  block: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: {
    fontWeight: '400',
  },
  activeWord: {
    borderRadius: 6,
    overflow: 'hidden',
  },
});
