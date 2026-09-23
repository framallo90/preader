import { Image } from 'expo-image';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Book } from '../types/storage';
import { getDisplayTitle } from '../utils/bookDisplay';
import { getDocumentTypeLabel } from '../utils/formatters';
import { ThemeColors, radius } from '../utils/theme';
import { BookBadge, getBookBadge } from './BookGridItem';
import { Icon } from './ui';

type Props = {
  book: Book;
  colors: ThemeColors;
  progress?: number;
  /** Texto de "te faltan ~2 h", ya calculado por el Inicio. */
  remaining?: string | null;
  onOpen: (book: Book) => void;
  onLongPress: (book: Book) => void;
};

const BADGE_LABEL: Record<Exclude<BookBadge, null>, string> = {
  reading: 'Leyendo',
  read: 'Leído',
  to_read: 'Para leer',
};

const BADGE_COLOR: Record<Exclude<BookBadge, null>, (c: ThemeColors) => string> = {
  reading: (c) => c.warm,
  read: (c) => c.success,
  to_read: (c) => c.primary,
};

/**
 * Un libro como renglón: tapa chica, título, autor y avance en una línea.
 *
 * La grilla luce mejor, pero con muchos libros la lista deja ver de un vistazo
 * el autor y cuánto te falta sin tener que entrar a cada uno.
 */
function BookListItemComponent({ book, colors, progress, remaining, onOpen, onLongPress }: Props) {
  const title = getDisplayTitle(book);
  const badge = getBookBadge(book.status, progress);
  const hasProgress = progress !== undefined && progress > 0;
  const handleOpen = useCallback(() => onOpen(book), [book, onOpen]);
  const handleLongPress = useCallback(() => onLongPress(book), [book, onLongPress]);

  return (
    <Pressable
      onPress={handleOpen}
      onLongPress={handleLongPress}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {book.coverUri ? (
        <Image source={{ uri: book.coverUri }} style={styles.cover} contentFit="cover" transition={80} />
      ) : (
        <View style={[styles.cover, styles.placeholder, { backgroundColor: colors.accent }]}>
          <Text style={[styles.placeholderText, { color: colors.primary }]}>{getDocumentTypeLabel(book.type)}</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{title}</Text>
        {book.author ? (
          <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>{book.author}</Text>
        ) : null}
        <View style={styles.meta}>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: BADGE_COLOR[badge](colors) }]}>
              <Text style={styles.badgeText}>{BADGE_LABEL[badge]}</Text>
            </View>
          ) : null}
          <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
            {hasProgress ? `${Math.max(1, Math.round(progress))} %` : badge === 'read' ? '' : 'Sin empezar'}
            {remaining && badge !== 'read' ? ` · ${remaining}` : ''}
          </Text>
        </View>
        {hasProgress ? (
          <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: badge === 'read' ? colors.success : colors.warm, width: `${Math.min(progress, 100)}%` },
              ]}
            />
          </View>
        ) : null}
      </View>
      {book.favorite ? <Icon name="heart" size={15} color={colors.warm} /> : null}
    </Pressable>
  );
}

/** Mismo motivo que la grilla: el Inicio se redibuja por cosas ajenas al libro. */
export const BookListItem = memo(BookListItemComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 44, height: 62, borderRadius: 6 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  body: { flex: 1, gap: 3 },
  title: { fontSize: 14.5, fontWeight: '700', lineHeight: 19 },
  author: { fontSize: 12.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1.5 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  metaText: { flex: 1, fontSize: 12 },
  track: { height: 3, borderRadius: 999, overflow: 'hidden', marginTop: 2 },
  fill: { height: '100%', borderRadius: 999 },
});
