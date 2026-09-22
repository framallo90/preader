import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemeColors, radius } from '../utils/theme';
import { Icon, IconName, Sheet } from './ui';

type Option = {
  value: string;
  label: string;
  description?: string;
  icon?: IconName;
  danger?: boolean;
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

/** Hoja con una lista de opciones (una por fila); la elegida se marca. */
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
    <Sheet visible={visible} onClose={onClose} colors={colors} title={title}>
      <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {options.map((option, index) => {
          const isSelected = option.value === selectedValue;
          const tint = option.danger ? colors.danger : isSelected ? colors.primary : colors.text;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={({ pressed }) => [
                styles.option,
                index < options.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : null,
                { backgroundColor: isSelected ? colors.accent : pressed ? colors.surfaceMuted : 'transparent' },
              ]}
            >
              {option.icon ? (
                <View style={[styles.optionIcon, { backgroundColor: option.danger ? colors.warmSoft : colors.accent }]}>
                  <Icon name={option.icon} size={19} color={option.danger ? colors.danger : colors.primary} />
                </View>
              ) : null}
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, { color: tint }]}>{option.label}</Text>
                {option.description ? (
                  <Text style={[styles.optionDescription, { color: colors.textMuted }]}>{option.description}</Text>
                ) : null}
              </View>
              {isSelected ? <Icon name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 54,
  },
  optionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontSize: 15.5,
    fontWeight: '600',
  },
  optionDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
});
