import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, ViewStyle, Pressable } from 'react-native';

import { ThemeColors, radius } from '../utils/theme';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  compact?: boolean;
  fullWidth?: boolean;
  /** Ícono a la izquierda del texto. */
  icon?: ComponentProps<typeof Ionicons>['name'];
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
  icon,
  style,
  labelStyle,
}: AppButtonProps) {
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.accent
        : variant === 'danger'
          ? colors.danger
          : 'transparent';

  const textColor =
    variant === 'primary' || variant === 'danger'
      ? colors.primaryText
      : variant === 'secondary'
        ? colors.primary
        : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        fullWidth ? styles.fullWidth : null,
        compact ? styles.compactButton : styles.defaultButton,
        {
          backgroundColor,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={compact ? 17 : 19} color={textColor} /> : null}
      <Text
        style={[
          styles.label,
          compact ? styles.compactLabel : null,
          {
            color: textColor,
          },
          labelStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullWidth: {
    width: '100%',
  },
  defaultButton: {
    minHeight: 50,
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
