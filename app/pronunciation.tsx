import { createAudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { Screen } from '../src/components/Screen';
import { IconButton, Row, Section } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { synthesizeSpeech } from '../src/services/systemTtsService';
import { applyPronunciations, cleanPronunciations } from '../src/utils/pronunciation';
import { radius } from '../src/utils/theme';

/**
 * Diccionario de pronunciación.
 *
 * La voz del teléfono lee mal los nombres inventados y en una saga uno escucha
 * el mismo error cientos de veces. Acá se le dice cómo decirlos. Sólo cambia lo
 * que se escucha: el texto del libro queda igual.
 */
export default function PronunciationScreen() {
  const { colors, settings, updateSettings } = useAppSettings();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const montadoRef = useRef(true);

  useEffect(() => () => {
    montadoRef.current = false;
    playerRef.current?.release();
    playerRef.current = null;
  }, []);

  const entries = settings.pronunciations;

  const escuchar = useCallback(async (frase: string) => {
    if (isTesting) return;
    setIsTesting(true);
    try {
      const uri = await synthesizeSpeech(`pron--${frase.slice(0, 40)}`, frase, settings.defaultVoiceId, 'es');
      if (!montadoRef.current) return; // saliste mientras sintetizaba
      playerRef.current?.release();
      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      player.play();
    } catch (error) {
      Alert.alert('No se pudo escuchar', error instanceof Error ? error.message : 'El motor de voz no respondió.');
    } finally {
      setIsTesting(false);
    }
  }, [isTesting, settings.defaultVoiceId]);

  const agregar = useCallback(async () => {
    const nuevo = { from: from.trim(), to: to.trim() };
    if (!nuevo.from || !nuevo.to) return;
    // Si ya estaba, la nueva forma reemplaza a la vieja.
    const sinRepetir = entries.filter((e) => e.from.trim().toLowerCase() !== nuevo.from.toLowerCase());
    const limpio = cleanPronunciations([...sinRepetir, nuevo]);
    await updateSettings({ pronunciations: limpio });
    setFrom('');
    setTo('');
  }, [from, to, entries, updateSettings]);

  const quitar = useCallback(async (palabra: string) => {
    await updateSettings({ pronunciations: entries.filter((e) => e.from !== palabra) });
  }, [entries, updateSettings]);

  const puedeAgregar = from.trim().length > 0 && to.trim().length > 0
    && from.trim().toLowerCase() !== to.trim().toLowerCase();

  return (
    <Screen colors={colors} scroll underHeader>
      <Stack.Screen options={{ title: 'Pronunciación' }} />

      <Section
        title="Agregar"
        colors={colors}
        hint={'Escribí la palabra como aparece en el libro y cómo querés que suene. Sólo palabras enteras: "Jon" no toca "Jonás".'}
      >
        <View style={styles.form}>
          <TextInput
            value={from}
            onChangeText={setFrom}
            placeholder="Como está escrito (Qhorin)"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
          />
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Cómo tiene que sonar (Corin)"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
          />
          <View style={styles.actions}>
            <AppButton
              label="Escuchar"
              icon="volume-high-outline"
              onPress={() => { void escuchar(to.trim()); }}
              disabled={!to.trim() || isTesting}
              variant="secondary"
              colors={colors}
              compact
            />
            <AppButton label="Agregar" icon="add" onPress={() => { void agregar(); }} disabled={!puedeAgregar} colors={colors} compact />
          </View>
        </View>
      </Section>

      <Section title={`Tu diccionario · ${entries.length}`} colors={colors}>
        {entries.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>
            Todavía no hay ninguna. Cuando la voz diga mal un nombre, agregalo acá.
          </Text>
        ) : (
          entries.map((entry, index) => (
            <Row
              key={entry.from}
              icon="text-outline"
              title={`${entry.from}  →  ${entry.to}`}
              colors={colors}
              onPress={() => { void escuchar(applyPronunciations(entry.from, [entry])); }}
              subtitle="Tocá para escucharla"
              right={<IconButton name="trash-outline" label={`Quitar ${entry.from}`} onPress={() => { void quitar(entry.from); }} colors={colors} />}
              last={index === entries.length - 1}
            />
          ))
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { padding: 12, gap: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  empty: { padding: 14, fontSize: 14, lineHeight: 20 },
});
