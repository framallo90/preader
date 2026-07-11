import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Book } from '../types/storage';
import { getDisplayTitle } from '../utils/bookDisplay';
import { ThemeColors } from '../utils/theme';

type BookGridItemProps = {
  book: Book;
  colors: ThemeColors;
  progress?: number; // 0-100
  onOpen: () => void;
  onLongPress: () => void;
};

const GENERATED_COVER_COLORS = ['#5f8c84', '#8c6f5f', '#5f6e8c', '#7a8c5f', '#8c5f7a', '#b08d57'];

function getGeneratedCoverColor(bookId: string): string {
  let hash = 0;
  for (let i = 0; i < bookId.length; i += 1) {
    hash = (hash * 31 + bookId.charCodeAt(i)) >>> 0;
  }
  return GENERATED_COVER_COLORS[hash % GENERATED_COVER_COLORS.length];
}

function getInitials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? '?'}${words[1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Libro como estantería: portada grande, título en dos líneas y una barrita
 * de progreso. Tap = abrir donde quedaste; mantener apretado = opciones.
 */
export function BookGridItem({ book, colors, progress, onOpen, onLongPress }: BookGridItemProps) {
  const title = getDisplayTitle(book);
  const hasProgress = progress !== undefined && progress > 0;

  return (
    <Pressable onPress={onOpen} onLongPress={onLongPress} style={styles.item}>
      {book.coverUri ? (
        <Image source={{ uri: book.coverUri }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.generatedCover, { backgroundColor: getGeneratedCoverColor(book.id) }]}>
          <Text style={styles.generatedCoverText}>{getInitials(title)}</Text>
        </View>
      )}
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
        {hasProgress ? (
          <View
            style={[
              styles.progressFill,
              { backgroundColor: colors.primary, width: `${Math.min(progress, 100)}%` },
            ]}
          />
        ) : null}
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      {hasProgress ? (
        <Text style={[styles.progressLabel, { color: colors.textMuted }]}>{progress.toFixed(0)}%</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    width: '31%',
    gap: 5,
  },
  cover: {
    width: '100%',
    aspectRatio: 0.7,
    borderRadius: 10,
    overflow: 'hidden',
  },
  generatedCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedCoverText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
  },
  progressTrack: {
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 16,
  },
  progressLabel: {
    fontSize: 10.5,
  },
});
