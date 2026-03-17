import { Pressable, StyleSheet, Text, View } from 'react-native';

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

export function ReaderBlockCard({
  block,
  isActive,
  colors,
  fontSize,
  wordRange,
  onPress,
}: ReaderBlockCardProps) {
  const lineHeight = Math.round(fontSize * 1.55);
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
      style={[
        styles.card,
        {
          backgroundColor: isActive ? colors.readerAccent : 'transparent',
          borderColor: isActive ? colors.primary : 'transparent',
        },
      ]}
    >
      {isActive ? (
        <Text style={[styles.blockLabel, { color: colors.textMuted }]}>Bloque {block.index + 1}</Text>
      ) : null}
      <View>
        <Text
          style={[
            styles.blockText,
            {
              color: colors.text,
              fontSize,
              lineHeight,
            },
          ]}
        >
          {activeWord ? (
            <>
              {activeWord.before}
              <Text
                style={[
                  styles.activeWord,
                  {
                    backgroundColor: colors.highlight,
                    color: colors.highlightText,
                  },
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
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 5,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  blockText: {
    fontWeight: '400',
  },
  activeWord: {
    borderRadius: 6,
    overflow: 'hidden',
  },
});
