import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemeColors } from '../utils/theme';

type Option = {
  value: string;
  label: string;
  description?: string;
};

type OptionPickerModalProps = {
  title: string;
  visible: boolean;
  options: Option[];
  selectedValue: string;
  colors: ThemeColors;
  onClose: () => void;
  onSelect: (value: string) => void;
};

export function OptionPickerModal({
  title,
  visible,
  options,
  selectedValue,
  colors,
  onClose,
  onSelect,
}: OptionPickerModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.closeLabel, { color: colors.primary }]}>Cerrar</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
            {options.map((option) => {
              const isSelected = option.value === selectedValue;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: isSelected ? colors.accent : colors.surfaceMuted,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <View style={styles.optionHeader}>
                    <Text style={[styles.optionLabel, { color: colors.text }]}>{option.label}</Text>
                    {isSelected ? (
                      <View
                        style={[
                          styles.selectionBadge,
                          {
                            backgroundColor: colors.primary,
                          },
                        ]}
                      >
                        <Text style={[styles.selectionBadgeText, { color: colors.primaryText }]}>
                          Actual
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {option.description ? (
                    <Text style={[styles.optionDescription, { color: colors.textMuted }]}>
                      {option.description}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: 18,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  listContent: {
    gap: 10,
    paddingBottom: 20,
  },
  option: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  selectionBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
