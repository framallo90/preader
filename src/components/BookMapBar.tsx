import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MapMarker } from '../utils/bookMap';
import { ThemeColors } from '../utils/theme';

type Props = {
  /** Dónde vas, 0..1. */
  progress: number;
  markers: MapMarker[];
  colors: ThemeColors;
  /** Recibe la fracción tocada (0..1); quien lo usa decide a dónde saltar. */
  onTap: (fraction: number) => void;
};

/**
 * El libro de punta a punta en una barra: rayitas en los capítulos, puntos en
 * tus notas y marcadores. Tocando se salta; cerca de una marca, el salto va a
 * la marca (ver resolveMapTap).
 */
function BookMapBarComponent({ progress, markers, colors, onTap }: Props) {
  const [width, setWidth] = useState(0);
  const pct = Math.min(Math.max(progress, 0), 1) * 100;
  const notas = markers.filter((m) => m.kind !== 'chapter').length;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.textMuted }]}>MAPA DEL LIBRO</Text>
        {notas > 0 ? (
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: colors.warm }]} />
            <Text style={[styles.legendText, { color: colors.textMuted }]}>
              {notas === 1 ? '1 anotación' : `${notas} anotaciones`}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (width > 0) onTap(event.nativeEvent.locationX / width);
        }}
        style={styles.hit}
        accessibilityRole="button"
        accessibilityLabel={`Mapa del libro, vas por el ${Math.round(pct)} por ciento`}
      >
        <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.fill, { backgroundColor: colors.primary, width: `${pct}%` }]} />
        </View>
        {markers.map((m, i) =>
          m.kind === 'chapter' ? (
            <View
              key={`c${i}`}
              pointerEvents="none"
              style={[styles.tick, { left: `${m.fraction * 100}%`, backgroundColor: colors.textMuted }]}
            />
          ) : (
            <View
              key={`n${i}`}
              pointerEvents="none"
              style={[
                styles.dot,
                {
                  left: `${m.fraction * 100}%`,
                  backgroundColor: m.kind === 'bookmark' ? colors.primary : colors.warm,
                  borderColor: colors.surface,
                },
              ]}
            />
          ),
        )}
        <View pointerEvents="none" style={[styles.here, { left: `${pct}%`, backgroundColor: colors.primary, borderColor: colors.surface }]} />
      </Pressable>
    </View>
  );
}

export const BookMapBar = memo(BookMapBarComponent);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 4, paddingBottom: 12, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11.5 },
  // Zona de toque más alta que la barra: con el dedo hace falta margen.
  hit: { height: 32, justifyContent: 'center' },
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', opacity: 0.35 },
  tick: { position: 'absolute', width: 1.5, height: 14, marginLeft: -0.75, top: 9, opacity: 0.6 },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, marginLeft: -5, top: 3, borderWidth: 1.5 },
  here: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, top: 9, borderWidth: 2 },
});
