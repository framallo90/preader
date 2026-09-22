import { Image } from 'expo-image';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Book } from '../types/storage';
import { getDisplayTitle } from '../utils/bookDisplay';
import { getDocumentTypeLabel } from '../utils/formatters';
import { ThemeColors } from '../utils/theme';
import { Icon } from './ui';

type BookGridItemProps = {
  book: Book;
  colors: ThemeColors;
  progress?: number; // 0-100
  /** Reciben el libro: así el Inicio puede pasar la MISMA función a todas las
   *  celdas y el memo de abajo sirve de algo. */
  onOpen: (book: Book) => void;
  onLongPress: (book: Book) => void;
};

// Tapas generadas: tinta, lacre, bosque, ocre, ciruela, pizarra, cuero y
// grafito. Todos dan 4,9:1 o más con el texto blanco de las iniciales.
const GENERATED_COVER_COLORS = ['#3A3785', '#B8492E', '#2F5E57', '#8A6D1F', '#5A2A52', '#3E5C7A', '#7A4B2A', '#4B5563'];

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
 * Libro como estantería: portada grande con etiqueta de formato, título en dos
 * líneas y barra de progreso. Tap = abrir donde quedaste; mantener = opciones.
 */
function BookGridItemComponent({ book, colors, progress, onOpen, onLongPress }: BookGridItemProps) {
  const title = getDisplayTitle(book);
  const hasProgress = progress !== undefined && progress > 0;
  const isFinished = book.status === 'read' || (progress !== undefined && progress >= 99.5);
  const handleOpen = useCallback(() => onOpen(book), [book, onOpen]);
  const handleLongPress = useCallback(() => onLongPress(book), [book, onLongPress]);

  return (
    <Pressable onPress={handleOpen} onLongPress={handleLongPress} delayLongPress={300} style={({ pressed }) => [styles.item, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.coverFrame, { backgroundColor: colors.surfaceMuted }]}>
        {book.coverUri ? (
          <Image source={{ uri: book.coverUri }} style={styles.cover} contentFit="cover" transition={80} />
        ) : (
          <View style={[styles.cover, styles.generatedCover, { backgroundColor: getGeneratedCoverColor(book.id) }]}>
            <Text style={styles.generatedCoverText}>{getInitials(title)}</Text>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: 'rgba(31,28,44,0.72)' }]}>
          <Text style={styles.badgeText}>{getDocumentTypeLabel(book.type)}</Text>
        </View>
        {book.favorite ? (
          <View style={styles.favorite}>
            <Icon name="heart" size={14} color={colors.warm} />
          </View>
        ) : null}
        {isFinished ? (
          <View style={[styles.finished, { backgroundColor: colors.success }]}>
            <Icon name="checkmark" size={12} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
        {hasProgress ? (
          <View
            style={[
              styles.progressFill,
              { backgroundColor: isFinished ? colors.success : colors.warm, width: `${Math.min(progress, 100)}%` },
            ]}
          />
        ) : null}
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
        {hasProgress ? `${Math.max(1, Math.round(progress))} %` : book.author ?? 'Sin empezar'}
      </Text>
    </Pressable>
  );
}

/**
 * Memoizado: el Inicio se vuelve a dibujar por cosas que no tienen nada que ver
 * con los libros (la voz avanzando, un filtro). Sin esto, cada pasada
 * reconciliaba las ~8 vistas de CADA libro de la biblioteca.
 */
export const BookGridItem = memo(BookGridItemComponent);

const styles = StyleSheet.create({
  item: {
    width: '31%',
    gap: 5,
  },
  coverFrame: {
    width: '100%',
    aspectRatio: 0.7,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  generatedCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedCoverText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
  },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  favorite: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finished: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
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
  meta: {
    fontSize: 11,
  },
});
