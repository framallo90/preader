import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { TextBlock } from '../types/document';
import { ReaderFontFamily } from '../types/storage';
import { prepareSpeechText } from '../utils/speechText';
import { ThemeColors } from '../utils/theme';
import { WordRange } from '../utils/wordRange';

/** Separación entre bloques: va como margen para que forme parte del alto de la celda. */
export const BLOCK_GAP = 4;
/** Padding vertical del bloque (arriba + abajo). */
export const BLOCK_VERTICAL_PADDING = 12;
/** Padding horizontal del bloque (izquierda + derecha). */
export const BLOCK_HORIZONTAL_PADDING = 24;

type ReaderBlockCardProps = {
  block: TextBlock;
  isActive: boolean;
  colors: ThemeColors;
  fontSize: number;
  /** Tipografía del lector (sans o serif del sistema), interlineado y justificado. */
  fontFamily?: ReaderFontFamily;
  lineHeightScale?: number;
  justify?: boolean;
  wordRange: WordRange;
  /** Estables (no cambian por render): reciben el bloque, así el memo de la tarjeta funciona. */
  onPressBlock: (block: TextBlock) => void;
  /** Mantener apretado: guardar cita o nota de este párrafo. */
  onLongPressBlock?: (block: TextBlock) => void;
  /** Alto real de la celda una vez dibujada (para posicionar la lista con exactitud). */
  onMeasured?: (index: number, height: number) => void;
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
  fontFamily = 'sans',
  lineHeightScale = 1.68,
  justify = false,
  wordRange,
  onPressBlock,
  onLongPressBlock,
  onMeasured,
}: ReaderBlockCardProps) {
  const lineHeight = Math.round(fontSize * lineHeightScale);
  // Un TXT o PDF trae los renglones cortados donde terminaba la línea impresa.
  // Se muestran unidos para que el párrafo fluya; el reemplazo es 1 a 1, así que
  // los índices de la palabra que suena siguen valiendo.
  const displayText = useMemo(() => prepareSpeechText(block.text), [block.text]);
  const activeWord =
    isActive && wordRange
      ? {
          before: displayText.slice(0, wordRange.start),
          current: displayText.slice(wordRange.start, wordRange.end),
          after: displayText.slice(wordRange.end),
        }
      : null;

  return (
    <Pressable
      onPress={() => onPressBlock(block)}
      onLongPress={onLongPressBlock ? () => onLongPressBlock(block) : undefined}
      onLayout={onMeasured ? (event) => onMeasured(block.index, event.nativeEvent.layout.height + BLOCK_GAP) : undefined}
      delayLongPress={350}
      style={[styles.block, isActive ? { backgroundColor: colors.readerAccent } : null]}
    >
      <Text
        style={[
          styles.text,
          { color: colors.text, fontSize, lineHeight, textAlign: justify ? 'justify' : 'left' },
          fontFamily === 'serif' ? styles.serif : null,
        ]}
      >
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
          displayText
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
    prev.fontFamily === next.fontFamily &&
    prev.lineHeightScale === next.lineHeightScale &&
    prev.justify === next.justify &&
    prev.colors === next.colors &&
    prev.wordRange === next.wordRange,
);

const styles = StyleSheet.create({
  block: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: BLOCK_GAP,
  },
  text: {
    fontWeight: '400',
  },
  // 'serif' es la familia con serifas del sistema (Noto Serif en Android).
  serif: {
    fontFamily: 'serif',
  },
  activeWord: {
    borderRadius: 6,
    overflow: 'hidden',
  },
});
