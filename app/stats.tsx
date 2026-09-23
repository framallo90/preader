import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../src/components/Screen';
import { Row, Section, Stepper } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { bookRepository } from '../src/storage/bookRepository';
import { withDatabaseRetry } from '../src/storage/database';
import { countFinishedSince, statsRepository } from '../src/storage/statsRepository';
import { getDisplayTitle } from '../src/utils/bookDisplay';
import {
  DayRow,
  computeStreak,
  dayKey,
  formatDuration,
  previousDay,
  splitMinutes,
  summarize,
  weekStart,
} from '../src/utils/readingStats';
import { radius } from '../src/utils/theme';

const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** Alto de las barras del gráfico de la semana. */
const CHART_HEIGHT = 110;

type Data = {
  rows: DayRow[];
  finishedThisYear: number;
  top: { title: string; seconds: number }[];
};

/**
 * Cuánto leés y escuchás de verdad.
 *
 * Todo se calcula de una tabla chica (una fila por libro, día y modo), así que
 * abrir esta pantalla es una consulta, no un recorrido por la biblioteca.
 */
export default function StatsScreen() {
  const { colors, settings, updateSettings } = useAppSettings();
  const [data, setData] = useState<Data | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const hoy = dayKey(new Date());
  const anio = new Date().getFullYear();

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void (async () => {
        try {
          const inicioAnio = `${anio}-01-01`;
          // La racha puede venir del año pasado: se trae un poco más de historia.
          const desde = `${anio - 1}-12-01`;
          const [rows, terminados, top, libros] = await withDatabaseRetry(() =>
            Promise.all([
              statsRepository.listDaysSince(desde),
              countFinishedSince(new Date(anio, 0, 1).toISOString()),
              statsRepository.topBooksSince(inicioAnio, 5),
              bookRepository.listAllBooks(),
            ]),
          );
          const porId = new Map(libros.map((b) => [b.id, b]));
          if (!vivo) return;
          setData({
            rows,
            finishedThisYear: terminados,
            top: top
              .map((t) => {
                const libro = porId.get(t.bookId);
                return libro ? { title: getDisplayTitle(libro), seconds: t.seconds } : null;
              })
              .filter((t): t is { title: string; seconds: number } => t !== null),
          });
        } catch {
          if (vivo) setData({ rows: [], finishedThisYear: 0, top: [] });
        }
      })();
      return () => { vivo = false; };
    }, [anio]),
  );

  const semana = useMemo(() => {
    // Los últimos siete días, terminando hoy.
    const dias: string[] = [];
    let d = hoy;
    for (let i = 0; i < 7; i += 1) {
      dias.unshift(d);
      d = previousDay(d);
    }
    const porDia = new Map<string, number>();
    for (const row of data?.rows ?? []) porDia.set(row.day, (porDia.get(row.day) ?? 0) + row.seconds);
    const valores = dias.map((day) => ({ day, seconds: porDia.get(day) ?? 0 }));
    const max = Math.max(...valores.map((v) => v.seconds), 1);
    return { valores, max };
  }, [data, hoy]);

  if (!data) {
    return (
      <Screen colors={colors} underHeader>
        <Stack.Screen options={{ title: 'Estadísticas' }} />
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      </Screen>
    );
  }

  const rows = data.rows;
  const hoyResumen = summarize(rows, hoy, hoy);
  const semanaResumen = summarize(rows, weekStart(new Date()), hoy);
  const mesResumen = summarize(rows, `${hoy.slice(0, 7)}-01`, hoy);
  const anioResumen = summarize(rows, `${anio}-01-01`, hoy);
  const racha = computeStreak(rows, hoy);
  const meta = settings.yearlyGoal;
  const avanceMeta = meta > 0 ? Math.min(data.finishedThisYear / meta, 1) : 0;
  const sinDatos = anioResumen.total === 0;

  const seleccionado = selectedDay ? semana.valores.find((v) => v.day === selectedDay) : null;
  const fechaDe = (day: string) => {
    const [y, m, dd] = day.split('-').map(Number);
    return new Date(y, m - 1, dd, 12);
  };

  return (
    <Screen colors={colors} scroll underHeader>
      <Stack.Screen options={{ title: 'Estadísticas' }} />

      {/* Lo más importante arriba, como número grande: la racha y hoy. */}
      <View style={styles.hero}>
        <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.tileValue, { color: colors.text }]}>{racha}</Text>
          <Text style={[styles.tileLabel, { color: colors.textMuted }]}>{racha === 1 ? 'día seguido' : 'días seguidos'}</Text>
        </View>
        <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.tileValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatDuration(hoyResumen.total)}
          </Text>
          <Text style={[styles.tileLabel, { color: colors.textMuted }]}>hoy</Text>
        </View>
      </View>

      {sinDatos ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          Todavía no hay nada medido. A partir de ahora, cada minuto que leas o escuches queda acá.
        </Text>
      ) : null}

      <Section title="Últimos siete días" colors={colors}>
        <View style={styles.chartWrap}>
          {/* Tocar una barra muestra su valor: es el equivalente táctil del
              "pasar el mouse". Los textos van en color de texto, no de barra. */}
          <Text style={[styles.chartReadout, { color: colors.text }]}>
            {seleccionado
              ? `${DAY_NAMES[fechaDe(seleccionado.day).getDay()]}: ${formatDuration(seleccionado.seconds)}`
              : `En total: ${formatDuration(semana.valores.reduce((t, v) => t + v.seconds, 0))}`}
          </Text>
          <View style={styles.chart}>
            {semana.valores.map((v) => {
              const alto = v.seconds > 0 ? Math.max((v.seconds / semana.max) * CHART_HEIGHT, 4) : 0;
              const esHoy = v.day === hoy;
              const elegido = v.day === selectedDay;
              const letra = DAY_LETTERS[fechaDe(v.day).getDay()];
              return (
                <Pressable
                  key={v.day}
                  style={styles.barSlot}
                  onPress={() => setSelectedDay(elegido ? null : v.day)}
                  accessibilityRole="button"
                  accessibilityLabel={`${DAY_NAMES[fechaDe(v.day).getDay()]}: ${formatDuration(v.seconds)}`}
                >
                  <View style={[styles.barArea, { height: CHART_HEIGHT }]}>
                    {alto > 0 ? (
                      <View
                        style={[
                          styles.bar,
                          {
                            height: alto,
                            backgroundColor: colors.primary,
                            opacity: selectedDay && !elegido ? 0.45 : 1,
                          },
                        ]}
                      />
                    ) : (
                      <View style={[styles.barEmpty, { backgroundColor: colors.border }]} />
                    )}
                  </View>
                  <Text style={[styles.barLabel, { color: esHoy ? colors.text : colors.textMuted, fontWeight: esHoy ? '800' : '600' }]}>
                    {letra}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Section>

      <Section title="Tiempo" colors={colors}>
        <Row icon="calendar-outline" title="Esta semana" subtitle={detalle(semanaResumen)} colors={colors} right={<Text style={[styles.value, { color: colors.text }]}>{formatDuration(semanaResumen.total)}</Text>} />
        <Row icon="calendar-outline" title="Este mes" subtitle={detalle(mesResumen)} colors={colors} right={<Text style={[styles.value, { color: colors.text }]}>{formatDuration(mesResumen.total)}</Text>} />
        <Row icon="calendar-outline" title={`En ${anio}`} subtitle={detalle(anioResumen)} colors={colors} right={<Text style={[styles.value, { color: colors.text }]}>{formatDuration(anioResumen.total)}</Text>} last />
      </Section>

      <Section
        title="Meta del año"
        colors={colors}
        hint="Cuenta los libros que llegaste a terminar este año. Los que marcás como leídos a mano no guardan fecha, así que no entran."
      >
        <Row
          icon="flag-outline"
          title={meta > 0 ? `${data.finishedThisYear} de ${meta} libros` : `${data.finishedThisYear} ${data.finishedThisYear === 1 ? 'libro terminado' : 'libros terminados'}`}
          colors={colors}
          right={
            <Stepper
              value={meta > 0 ? String(meta) : 'Sin meta'}
              onDecrease={() => { void updateSettings({ yearlyGoal: Math.max(meta - 1, 0) }); }}
              onIncrease={() => { void updateSettings({ yearlyGoal: meta + 1 }); }}
              canDecrease={meta > 0}
              canIncrease={meta < 500}
              colors={colors}
            />
          }
          last={meta === 0}
        />
        {meta > 0 ? (
          <View style={styles.goalWrap}>
            <View style={[styles.goalTrack, { backgroundColor: colors.surfaceMuted }]}>
              <View style={[styles.goalFill, { backgroundColor: colors.warm, width: `${avanceMeta * 100}%` }]} />
            </View>
          </View>
        ) : null}
      </Section>

      {data.top.length > 0 ? (
        <Section title={`Lo que más te acompañó en ${anio}`} colors={colors}>
          {data.top.map((t, i) => (
            <Row
              key={`${t.title}-${i}`}
              icon="book-outline"
              title={t.title}
              colors={colors}
              right={<Text style={[styles.value, { color: colors.textMuted }]}>{formatDuration(t.seconds)}</Text>}
              last={i === data.top.length - 1}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function detalle(resumen: { read: number; listen: number }): string {
  if (resumen.read === 0 && resumen.listen === 0) return 'Nada todavía';
  const partes = splitMinutes(resumen.read, resumen.listen);
  return `Leído ${formatDuration(partes.read * 60)} · escuchado ${formatDuration(partes.listen * 60)}`;
}

const styles = StyleSheet.create({
  spinner: { marginTop: 40 },
  hero: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 2,
  },
  tileValue: { fontSize: 28, fontWeight: '800' },
  tileLabel: { fontSize: 13, fontWeight: '600' },
  empty: { fontSize: 14, lineHeight: 20, marginVertical: 8 },
  chartWrap: { padding: 14, gap: 10 },
  chartReadout: { fontSize: 14, fontWeight: '700' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, alignItems: 'center', gap: 6 },
  barArea: { width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  // Barra fina con el extremo de arriba redondeado y la base plana, apoyada en el piso.
  bar: { width: '62%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barEmpty: { width: '62%', height: 2, borderRadius: 1 },
  barLabel: { fontSize: 12 },
  value: { fontSize: 14, fontWeight: '700' },
  goalWrap: { paddingHorizontal: 14, paddingBottom: 14 },
  goalTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  goalFill: { height: '100%', borderRadius: 999 },
});
