import { Pressable, StyleSheet, Text, View } from 'react-native';

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

export function RecentDocumentCard({
  document,
  colors,
  progress,
  onOpen,
  onDelete,
}: RecentDocumentCardProps) {
  const hasProgress = progress !== undefined && progress > 0;

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
      <View style={styles.headerRow}>
        <View style={[styles.typeBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.typeBadgeText, { color: colors.text }]}>
            {getDocumentTypeLabel(document.type)}
          </Text>
        </View>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {formatRelativeDateLabel(document.lastOpenedAt)}
        </Text>
      </View>

      <View style={styles.copy}>
        <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={2}>
          {document.name}
        </Text>
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
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  copy: {
    gap: 8,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressGroup: {
    gap: 5,
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
