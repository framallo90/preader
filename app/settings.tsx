import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { authService } from '../src/services/authService';
import { getDisplayNameFromSafUri, requestLibraryFolder } from '../src/services/libraryScanService';
import { premiumService, PremiumListener } from '../src/services/premiumService';
import { clampRounded } from '../src/utils/math';

const MIN_RATE = 0.6;
const MAX_RATE = 1.6;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;

// Voces disponibles en OpenAI TTS (coincide con reader.tsx)
const OPENAI_VOICE_OPTIONS = [
  { value: 'onyx', label: 'Onyx', description: 'Voz masculina profunda y narrativa (por defecto).' },
  { value: 'nova', label: 'Nova', description: 'Voz femenina clara y energica.' },
  { value: 'alloy', label: 'Alloy', description: 'Voz neutra y versatil.' },
  { value: 'echo', label: 'Echo', description: 'Voz masculina expresiva.' },
  { value: 'fable', label: 'Fable', description: 'Voz masculina calida y dramatica.' },
  { value: 'shimmer', label: 'Shimmer', description: 'Voz femenina suave.' },
];
const VALID_OPENAI_VOICES = new Set(OPENAI_VOICE_OPTIONS.map((v) => v.value));

export default function SettingsScreen() {
  const { colors, settings, updateSettings } = useAppSettings();
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [isPremium, setIsPremium] = useState(premiumService.isPremium);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const listener: PremiumListener = (premium) => { setIsPremium(premium); };
    return premiumService.subscribe(listener);
  }, []);

  useEffect(() => {
    void authService.getSession().then((session) => setHasSession(Boolean(session)));
  }, []);

  const handleAddLibraryFolder = useCallback(async () => {
    const folderUri = await requestLibraryFolder();
    if (!folderUri || settings.libraryFolders.includes(folderUri)) return;
    await updateSettings({ libraryFolders: [...settings.libraryFolders, folderUri] });
  }, [settings.libraryFolders, updateSettings]);

  const handleRemoveLibraryFolder = useCallback(
    async (folderUri: string) => {
      await updateSettings({
        libraryFolders: settings.libraryFolders.filter((item) => item !== folderUri),
      });
    },
    [settings.libraryFolders, updateSettings],
  );

  const handleLogout = useCallback(() => {
    Alert.alert('Cerrar sesión', '¿Seguro que querés salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: () => { void authService.signOut(); },
      },
    ]);
  }, []);

  const effectiveVoiceId = useMemo(() => {
    const saved = settings.defaultVoiceId;
    return saved && VALID_OPENAI_VOICES.has(saved) ? saved : 'onyx';
  }, [settings.defaultVoiceId]);

  const selectedVoiceLabel = useMemo(
    () => OPENAI_VOICE_OPTIONS.find((v) => v.value === effectiveVoiceId)?.label ?? 'Onyx',
    [effectiveVoiceId],
  );

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Ajusta la experiencia a tu ritmo
        </Text>
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
              <Text style={[styles.valueText, { color: colors.text }]}>
                {settings.fontSize.toFixed(0)}
              </Text>
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
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Velocidad por defecto
              </Text>
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
              <Text style={[styles.valueText, { color: colors.text }]}>
                {settings.defaultRate.toFixed(2)}x
              </Text>
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
              <Text style={[styles.settingTitle, { color: colors.text }]}>Voz OpenAI TTS</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Voz usada para generar el audio. Se cachea por voz, cambiarla regenera el audio.
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

      <View style={styles.sectionGroup}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Biblioteca</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Carpetas escaneadas</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Los libros de estas carpetas se agregan solos a la biblioteca al abrir la app.
              </Text>
            </View>
            <AppButton
              label="Agregar"
              onPress={() => { void handleAddLibraryFolder(); }}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>
          {settings.libraryFolders.map((folderUri) => (
            <View key={folderUri}>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[styles.settingTitle, { color: colors.text }]} numberOfLines={1}>
                    {getDisplayNameFromSafUri(folderUri)}
                  </Text>
                </View>
                <AppButton
                  label="Quitar"
                  onPress={() => { void handleRemoveLibraryFolder(folderUri); }}
                  variant="ghost"
                  colors={colors}
                  compact
                  labelStyle={{ color: colors.danger }}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.sectionGroup}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Cuenta</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {isPremium ? '✦ Premium activo' : 'Plan gratuito'}
              </Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                {isPremium
                  ? 'Voces de IA, contexto de capítulos y chat companion habilitados.'
                  : 'Lectura con voz del sistema. Suscribite para IA premium.'}
              </Text>
            </View>
            {!isPremium ? (
              <AppButton
                label="Premium"
                onPress={() => router.push('/subscription')}
                colors={colors}
                compact
              />
            ) : null}
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Sesión</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                {hasSession
                  ? 'Cerrá sesión para cambiar de cuenta.'
                  : 'No hace falta cuenta para leer. Se usa solo para Premium.'}
              </Text>
            </View>
            {hasSession ? (
              <AppButton
                label="Salir"
                onPress={handleLogout}
                variant="secondary"
                colors={colors}
                compact
              />
            ) : (
              <AppButton
                label="Iniciar sesión"
                onPress={() => router.push('/login')}
                variant="secondary"
                colors={colors}
                compact
              />
            )}
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
          El audio se genera con OpenAI TTS (tts-1-hd) y se cachea localmente. La primera
          reproduccion requiere conexion; despues funciona sin red.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          Cambiar de voz en ajustes provoca que el proximo tramo regenere audio con la nueva voz.
          Los tramos con la voz anterior siguen en cache.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          El texto de cada tramo pasa por Claude Haiku antes de la sintesis para limpiar artefactos
          de conversion y mejorar la pronunciacion.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          Al terminar cada capitulo se extrae contexto automaticamente en background (personajes,
          resumen, eventos clave). El banner del siguiente capitulo muestra el resumen.
        </Text>
      </View>

      <OptionPickerModal
        title="Voz OpenAI TTS"
        visible={isVoicePickerVisible}
        colors={colors}
        selectedValue={effectiveVoiceId}
        options={OPENAI_VOICE_OPTIONS}
        onClose={() => setIsVoicePickerVisible(false)}
        onSelect={(value) => {
          setIsVoicePickerVisible(false);
          void updateSettings({ defaultVoiceId: value });
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
