import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { SpeechVoice, speechService } from '../src/services/speechService';
import { clampRounded } from '../src/utils/math';

const SYSTEM_VOICE_VALUE = '__system__';
const MIN_RATE = 0.6;
const MAX_RATE = 1.6;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;

function sortVoices(voices: SpeechVoice[]) {
  return [...voices].sort((left, right) => {
    if (left.language === right.language) {
      return left.name.localeCompare(right.name);
    }

    if (left.language.startsWith('es')) {
      return -1;
    }

    if (right.language.startsWith('es')) {
      return 1;
    }

    return left.language.localeCompare(right.language);
  });
}

export default function SettingsScreen() {
  const { colors, settings, updateSettings } = useAppSettings();
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void speechService
      .getVoices()
      .then((availableVoices) => {
        if (isMounted) {
          setVoices(sortVoices(availableVoices));
        }
      })
      .catch(() => {
        if (isMounted) {
          setVoices([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const voiceOptions = useMemo(
    () => [
      {
        value: SYSTEM_VOICE_VALUE,
        label: 'Sistema',
        description: 'Usa la voz por defecto del dispositivo.',
      },
      ...voices.map((voice) => ({
        value: voice.identifier,
        label: voice.name,
        description: voice.language,
      })),
    ],
    [voices],
  );

  const selectedVoiceLabel = useMemo(() => {
    if (!settings.defaultVoiceId) {
      return 'Sistema';
    }

    return voices.find((voice) => voice.identifier === settings.defaultVoiceId)?.name ?? 'Sistema';
  }, [settings.defaultVoiceId, voices]);

  const updateRate = useCallback(
    async (delta: number) => {
      await updateSettings({
        defaultRate: clampRounded(settings.defaultRate + delta, MIN_RATE, MAX_RATE),
      });
    },
    [settings.defaultRate, updateSettings],
  );

  const updateFontSize = useCallback(
    async (delta: number) => {
      await updateSettings({
        fontSize: clampRounded(settings.fontSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE),
      });
    },
    [settings.fontSize, updateSettings],
  );

  return (
    <Screen colors={colors} scroll contentContainerStyle={styles.screenContent}>
      <Stack.Screen options={{ title: 'Ajustes' }} />

      <View style={styles.headerBlock}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ajusta la experiencia a tu ritmo</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
          Deja listo el lector una vez y despues concentrate solo en abrir el documento y escuchar.
        </Text>
      </View>

      <View style={styles.sectionGroup}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Apariencia</Text>
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Modo oscuro</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Cambia entre fondo claro y oscuro sin depender del sistema.
              </Text>
            </View>
            <Switch
              value={settings.darkMode}
              onValueChange={(value) => {
                void updateSettings({ darkMode: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </View>
      </View>

      <View style={styles.sectionGroup}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Lectura y audio</Text>
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Tamano de fuente</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Se aplica al texto del lector.
              </Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton
                label="-"
                onPress={() => void updateFontSize(-1)}
                variant="secondary"
                colors={colors}
                compact
              />
              <Text style={[styles.valueText, { color: colors.text }]}>{settings.fontSize.toFixed(0)}</Text>
              <AppButton
                label="+"
                onPress={() => void updateFontSize(1)}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Velocidad por defecto</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Valor inicial que usa el lector al empezar o retomar.
              </Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton
                label="-"
                onPress={() => void updateRate(-0.1)}
                variant="secondary"
                colors={colors}
                compact
              />
              <Text style={[styles.valueText, { color: colors.text }]}>{settings.defaultRate.toFixed(2)}x</Text>
              <AppButton
                label="+"
                onPress={() => void updateRate(0.1)}
                variant="secondary"
                colors={colors}
                compact
              />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Voz por defecto</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Se usa en el lector salvo que elijas otra mas adelante.
              </Text>
            </View>
            <AppButton
              label={selectedVoiceLabel}
              onPress={() => setIsVoicePickerVisible(true)}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Mantener pantalla encendida al leer
              </Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Util cuando quieres seguir viendo el resaltado mientras la voz avanza.
              </Text>
            </View>
            <Switch
              value={settings.keepScreenAwakeWhileReading}
              onValueChange={(value) => {
                void updateSettings({ keepScreenAwakeWhileReading: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </View>
      </View>

      <View style={styles.sectionGroup}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Inicio</Text>
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Reabrir ultimo documento al iniciar
              </Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Si estabas leyendo siempre lo mismo, te ahorra un toque al abrir la app.
              </Text>
            </View>
            <Switch
              value={settings.reopenLastDocumentOnLaunch}
              onValueChange={(value) => {
                void updateSettings({ reopenLastDocumentOnLaunch: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </View>
      </View>

      <View
        style={[
          styles.notesCard,
          {
            backgroundColor: colors.readerSurface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.notesTitle, { color: colors.text }]}>Notas de esta version</Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          La app guarda cache local del texto parseado para abrir mas rapido documentos ya leidos.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          Si el PDF es un escaneo sin texto extraible, la app lo informa y no intenta OCR.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          En Android no se usa pausa nativa porque `expo-speech` no la soporta: se detiene, guarda el
          punto actual y retoma desde el subindice mas cercano.
        </Text>
      </View>

      <OptionPickerModal
        title="Voz por defecto"
        visible={isVoicePickerVisible}
        colors={colors}
        selectedValue={settings.defaultVoiceId ?? SYSTEM_VOICE_VALUE}
        options={voiceOptions}
        onClose={() => setIsVoicePickerVisible(false)}
        onSelect={(value) => {
          setIsVoicePickerVisible(false);
          void updateSettings({
            defaultVoiceId: value === SYSTEM_VOICE_VALUE ? null : value,
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 20,
  },
  headerBlock: {
    gap: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  headerSubtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  sectionGroup: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  settingCopy: {
    flex: 1,
    gap: 4,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  valueText: {
    minWidth: 56,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  notesCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  notesTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
