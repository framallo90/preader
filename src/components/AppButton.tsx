import { StyleProp, StyleSheet, Text, TextStyle, ViewStyle, Pressable } from 'react-native';

import { ThemeColors } from '../utils/theme';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  compact?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export function AppButton({
  label,
  onPress,
  colors,
  variant = 'primary',
  disabled = false,
  compact = false,
  fullWidth = false,
  style,
  labelStyle,
}: AppButtonProps) {
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.surfaceMuted
        : variant === 'danger'
          ? colors.danger
          : 'transparent';

  const borderColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'ghost'
        ? 'transparent'
      : variant === 'danger'
        ? colors.danger
        : colors.border;

  const textColor =
    variant === 'primary' || variant === 'danger'
      ? colors.primaryText
      : variant === 'secondary'
        ? colors.text
        : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        fullWidth ? styles.fullWidth : null,
        compact ? styles.compactButton : styles.defaultButton,
        {
          backgroundColor,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          compact ? styles.compactLabel : null,
          {
            color: textColor,
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  defaultButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  compactButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
  compactLabel: {
    fontSize: 14,
  },
});
