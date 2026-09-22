import { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeColors } from '../utils/theme';

type ScreenProps = PropsWithChildren<{
  colors: ThemeColors;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Elementos que flotan sobre el contenido (un botón +, por ejemplo). */
  floating?: ReactNode;
  /**
   * La pantalla tiene la cabecera del navegador arriba: no hay que sumarle el
   * inset superior (dejaba una franja vacía de ~60 px debajo del título).
   */
  underHeader?: boolean;
}>;

const EDGES_ALL = ['top', 'left', 'right', 'bottom'] as const;
const EDGES_UNDER_HEADER = ['left', 'right', 'bottom'] as const;

export function Screen({
  children,
  colors,
  scroll = false,
  contentContainerStyle,
  floating,
  underHeader = false,
}: ScreenProps) {
  const edges = underHeader ? EDGES_UNDER_HEADER : EDGES_ALL;
  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor: colors.background }]}>
        {/* La app es edge-to-edge: Android ya no achica la ventana cuando abre el
            teclado, así que sin esto el campo enfocado quedaba tapado. */}
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.scrollContent, floating ? styles.scrollContentWithFloating : null, contentContainerStyle]}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
        {floating ? <View pointerEvents="box-none" style={styles.floating}>{floating}</View> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: colors.background }, contentContainerStyle]}
    >
      <View style={styles.fill}>{children}</View>
      {floating ? <View pointerEvents="box-none" style={styles.floating}>{floating}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 30,
    gap: 18,
  },
  scrollContentWithFloating: {
    paddingBottom: 110,
  },
  floating: {
    position: 'absolute',
    right: 18,
    bottom: 22,
  },
});
