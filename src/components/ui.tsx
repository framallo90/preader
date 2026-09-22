/**
 * Piezas de interfaz compartidas por todas las pantallas. La idea es que Inicio,
 * el lector, Ajustes y "Sobre este libro" se vean de la misma familia: mismos
 * radios, mismas filas, mismos íconos y la misma forma de abrir una hoja.
 */
import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { ThemeColors, radius, space } from '../utils/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type IconProps = { name: IconName; size?: number; color: string; style?: StyleProp<TextStyle> };

export function Icon({ name, size = 22, color, style }: IconProps) {
  return <Ionicons name={name} size={size} color={color} style={style} />;
}

type IconButtonProps = {
  name: IconName;
  onPress: () => void;
  colors: ThemeColors;
  label: string;
  /** Solo ícono (por defecto) o ícono con el texto debajo (barras de herramientas). */
  showLabel?: boolean;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  /** 'plain' no dibuja fondo; 'tonal' sí (para cabeceras). */
  variant?: 'plain' | 'tonal';
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  name,
  onPress,
  colors,
  label,
  showLabel = false,
  active = false,
  disabled = false,
  size = 22,
  variant = 'plain',
  style,
}: IconButtonProps) {
  const tint = disabled ? colors.textMuted : active ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        showLabel ? styles.iconButtonLabeled : null,
        variant === 'tonal' ? { backgroundColor: active ? colors.accent : colors.surfaceMuted } : null,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={tint} />
      {showLabel ? (
        <Text style={[styles.iconButtonLabel, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

type ChipProps = {
  label: string;
  active?: boolean;
  onPress: () => void;
  /** Mantener apretado (p. ej. borrar una colección). */
  onLongPress?: () => void;
  colors: ThemeColors;
  icon?: IconName;
};

/** Filtro o selector de una opción entre pocas (Todos · Leyendo · Sepia …). */
export function Chip({ label, active = false, onPress, onLongPress, colors, icon }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.surface,
          borderColor: active ? colors.primary : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={active ? colors.primaryText : colors.textMuted} /> : null}
      <Text style={[styles.chipLabel, { color: active ? colors.primaryText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

type SectionProps = PropsWithChildren<{ title: string; colors: ThemeColors; hint?: string; style?: StyleProp<ViewStyle> }>;

/** Grupo de filas con título arriba (Ajustes, "Sobre este libro"). */
export function Section({ title, hint, colors, children, style }: SectionProps) {
  return (
    <View style={[styles.section, style]}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
      {hint ? <Text style={[styles.sectionHint, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

type RowProps = {
  icon?: IconName;
  title: string;
  subtitle?: string;
  /** Lo que va a la derecha: un valor, un switch, un botón. */
  right?: ReactNode;
  onPress?: () => void;
  colors: ThemeColors;
  /** Última fila del grupo: sin línea divisoria. */
  last?: boolean;
  danger?: boolean;
};

/** Fila de una lista de opciones: ícono · título/subtítulo · control a la derecha. */
export function Row({ icon, title, subtitle, right, onPress, colors, last = false, danger = false }: RowProps) {
  const content = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: danger ? colors.warmSoft : colors.accent }]}>
          <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.primary} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: danger ? colors.danger : colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? <View style={styles.rowRight}>{right}</View> : null}
      {onPress && right === undefined ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </>
  );
  const rowStyle = [styles.row, last ? null : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.7 : 1 }]}>
        {content}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{content}</View>;
}

/** Valor a la derecha de una fila ("Sepia", "0.95x"). */
export function RowValue({ children, colors }: { children: ReactNode; colors: ThemeColors }) {
  return <Text style={[styles.rowValue, { color: colors.textMuted }]}>{children}</Text>;
}

type StepperProps = {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  colors: ThemeColors;
  disabled?: boolean;
  canDecrease?: boolean;
  canIncrease?: boolean;
};

/** − valor + : velocidad, tamaño de letra, atenuación. */
export function Stepper({ value, onDecrease, onIncrease, colors, disabled = false, canDecrease = true, canIncrease = true }: StepperProps) {
  return (
    <View style={[styles.stepper, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <IconButton name="remove" label="Menos" onPress={onDecrease} colors={colors} disabled={disabled || !canDecrease} size={20} />
      <Text style={[styles.stepperValue, { color: colors.text }]}>{value}</Text>
      <IconButton name="add" label="Más" onPress={onIncrease} colors={colors} disabled={disabled || !canIncrease} size={20} />
    </View>
  );
}

type SheetProps = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  title?: string;
  /** Anclada arriba (búsqueda, con teclado) en vez de abajo. */
  top?: boolean;
  /** Alto máximo como fracción de la pantalla. */
  maxHeight?: `${number}%`;
  scroll?: boolean;
}>;

/** Hoja modal con manija, título y cierre tocando afuera. */
export function Sheet({ visible, onClose, colors, title, top = false, maxHeight = '80%', scroll = true, children }: SheetProps) {
  const body = scroll ? (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.sheetContent}>{children}</View>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.sheetBackdrop, top ? styles.sheetBackdropTop : null, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View
          style={[
            styles.sheet,
            top ? styles.sheetTop : styles.sheetBottom,
            { backgroundColor: colors.surface, borderColor: colors.border, maxHeight },
          ]}
        >
          {top ? null : <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />}
          {title ? (
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
              <IconButton name="close" label="Cerrar" onPress={onClose} colors={colors} size={22} />
            </View>
          ) : null}
          {body}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  iconButtonLabeled: { gap: 2, paddingVertical: 6, minWidth: 64 },
  iconButtonLabel: { fontSize: 11, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipLabel: { fontSize: 13.5, fontWeight: '600' },
  section: { gap: space.sm },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 4 },
  sectionCard: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  sectionHint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 13,
    minHeight: 56,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 13, lineHeight: 18 },
  rowRight: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' },
  rowValue: { fontSize: 14.5, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 2 },
  stepperValue: { minWidth: 52, textAlign: 'center', fontSize: 14.5, fontWeight: '700' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdropTop: { justifyContent: 'flex-start' },
  sheet: { borderWidth: 1, paddingBottom: space.lg },
  sheetBottom: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm },
  sheetTop: { borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, paddingTop: 44 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.xl, paddingRight: space.md, paddingBottom: space.xs },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetContent: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
});
