import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Book } from '../types/storage';
import { formatRelativeDateLabel, getDocumentTypeLabel } from '../utils/formatters';
import { ThemeColors } from '../utils/theme';
import { AppButton } from './AppButton';

type RecentDocumentCardProps = {
  document: Book;
  colors: ThemeColors;
  progress?: number; // 0-100, undefined = sin progreso guardado
  onOpen: () => void;
  onDelete: () => void;
};

// Paleta editorial para portadas generadas (tonos del brand board).
const GENERATED_COVER_COLORS = ['#5f8c84', '#8c6f5f', '#5f6e8c', '#7a8c5f', '#8c5f7a', '#b08d57'];

function getGeneratedCoverColor(bookId: string): string {
  let hash = 0;
  for (let i = 0; i < bookId.length; i += 1) {
    hash = (hash * 31 + bookId.charCodeAt(i)) >>> 0;
  }
  return GENERATED_COVER_COLORS[hash % GENERATED_COVER_COLORS.length];
}

function getInitials(title: string): string {
  const words = title.replace(/\.[^.]+$/, '').split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

export function RecentDocumentCard({
  document,
  colors,
  progress,
  onOpen,
  onDelete,
}: RecentDocumentCardProps) {
  const hasProgress = progress !== undefined && progress > 0;
  const displayTitle = document.title ?? document.name;

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.mainRow}>
        {document.coverUri ? (
          <Image source={{ uri: document.coverUri }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.generatedCover, { backgroundColor: getGeneratedCoverColor(document.id) }]}>
            <Text style={styles.generatedCoverText}>{getInitials(displayTitle)}</Text>
          </View>
        )}

        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {displayTitle}
          </Text>
          {document.author ? (
            <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>
              {document.author}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <View style={[styles.typeBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.typeBadgeText, { color: colors.text }]}>
                {getDocumentTypeLabel(document.type)}
              </Text>
            </View>
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              {formatRelativeDateLabel(document.lastOpenedAt)}
            </Text>
          </View>

          {hasProgress ? (
            <View style={styles.progressGroup}>
              <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.primary,
                      width: `${Math.min(progress, 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressLabel, { color: colors.textMuted }]}>
                {progress.toFixed(0)}% leido
              </Text>
            </View>
          ) : (
            <Text style={[styles.helperText, { color: colors.textMuted }]}>
              Sin progreso guardado aun.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        <Text style={[styles.openHint, { color: colors.primary }]}>
          {hasProgress ? 'Continuar' : 'Abrir'}
        </Text>
        <AppButton
          label="Eliminar"
          onPress={onDelete}
          colors={colors}
          variant="ghost"
          compact
          labelStyle={{ color: colors.danger }}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    gap: 10,
  },
  mainRow: {
    flexDirection: 'row',
    gap: 14,
  },
  cover: {
    width: 62,
    height: 88,
    borderRadius: 8,
    overflow: 'hidden',
  },
  generatedCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedCoverText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  copy: {
    flex: 1,
    gap: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  author: {
    fontSize: 13,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  progressGroup: {
    gap: 5,
    marginTop: 2,
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressLabel: {
    fontSize: 12,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
  meta: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  openHint: {
    fontSize: 13,
    fontWeight: '700',
  },
});
