import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StoredDocument } from '../types/storage';
import { formatRelativeDateLabel, getDocumentTypeLabel } from '../utils/formatters';
import { ThemeColors } from '../utils/theme';
import { AppButton } from './AppButton';

type RecentDocumentCardProps = {
  document: StoredDocument;
  colors: ThemeColors;
  onOpen: () => void;
  onDelete: () => void;
};

export function RecentDocumentCard({
  document,
  colors,
  onOpen,
  onDelete,
}: RecentDocumentCardProps) {
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
        <View
          style={[
            styles.typeBadge,
            {
              backgroundColor: colors.accent,
            },
          ]}
        >
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
        <Text style={[styles.helperText, { color: colors.textMuted }]}>
          Toca la tarjeta para abrir y continuar desde tu ultimo punto.
        </Text>
      </View>

      <View style={styles.actions}>
        <Text style={[styles.openHint, { color: colors.primary }]}>Abrir</Text>
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
    gap: 6,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
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
