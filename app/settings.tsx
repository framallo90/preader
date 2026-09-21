import { createAudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';

import { getDisplayNameFromSafUri, requestLibraryFolder, restoreIgnoredBooks } from '../src/services/libraryScanService';
import { clearAllPdfPages } from '../src/services/pdfLocalService';
import { clearAllAudio, listVoices, synthesizeSpeech } from '../src/services/systemTtsService';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { documentAudioPlaybackService } from '../src/services/documentAudioPlaybackService';
import { clampRounded } from '../src/utils/math';
import { ReadingTheme } from '../src/types/storage';
import { getSafFolderPath } from '../src/utils/safPaths';
import { VoiceOption, buildVoiceOptions, primaryLanguage } from '../src/utils/voices';

const AUTO_VOICE = 'auto';
const AUTO_VOICE_OPTION: VoiceOption = {
  value: AUTO_VOICE,
  label: 'Automática',
  description: 'Elige sola la mejor voz instalada según el idioma de cada libro.',
};
const READING_THEME_OPTIONS: Array<{ value: ReadingTheme; label: string; description: string }> = [
  { value: 'auto', label: 'Automático', description: 'Día o noche según el modo oscuro de la app.' },
  { value: 'day', label: 'Día', description: 'Página blanca.' },
  { value: 'sepia', label: 'Sepia', description: 'Papel cálido, descansa la vista.' },
  { value: 'night', label: 'Noche', description: 'Página oscura con texto claro.' },
];
const SAMPLE_TEXTS: Record<string, string> = {
  es: 'Esta es la voz que va a leer tus libros.',
  en: 'This is the voice that will read your books.',
  pt: 'Esta é a voz que vai ler os seus livros.',
  fr: 'Voici la voix qui va lire vos livres.',
  it: 'Questa è la voce che leggerà i tuoi libri.',
  de: 'Dies ist die Stimme, die deine Bücher vorlesen wird.',
};

const MIN_RATE = 0.6;
const MAX_RATE = 1.6;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;

export default function SettingsScreen() {
  const { colors, settings, updateSettings } = useAppSettings();
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [isThemePickerVisible, setIsThemePickerVisible] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [voiceLanguages, setVoiceLanguages] = useState<Map<string, string>>(new Map());
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const samplePlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const loadVoices = useCallback(async (forceRefresh: boolean) => {
    try {
      const voices = await listVoices(forceRefresh);
      setVoiceOptions(buildVoiceOptions(voices));
      setVoiceLanguages(new Map(voices.map((v) => [v.identifier, v.language])));
      setVoiceError(null);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'No se pudieron leer las voces del teléfono.');
    }
  }, []);

  useEffect(() => {
    void loadVoices(false);
    return () => {
      samplePlayerRef.current?.release();
      samplePlayerRef.current = null;
    };
  }, [loadVoices]);

  const handleAddLibraryFolder = useCallback(async () => {
    const folderUri = await requestLibraryFolder();
    if (!folderUri || settings.libraryFolders.includes(folderUri)) return;
    await updateSettings({ libraryFolders: [...settings.libraryFolders, folderUri] });
  }, [settings.libraryFolders, updateSettings]);

  // Se elige la subcarpeta con el mismo selector del sistema; se guarda su ruta
  // legible, que es la que el escaneo compara.
  const handleAddExcludedFolder = useCallback(async () => {
    const folderUri = await requestLibraryFolder();
    if (!folderUri) return;
    const path = getSafFolderPath(folderUri);
    if (!path || settings.excludedFolders.includes(path)) return;
    await updateSettings({ excludedFolders: [...settings.excludedFolders, path] });
  }, [settings.excludedFolders, updateSettings]);

  const handleRemoveExcludedFolder = useCallback(
    async (path: string) => {
      await updateSettings({ excludedFolders: settings.excludedFolders.filter((item) => item !== path) });
    },
    [settings.excludedFolders, updateSettings],
  );

  const handleRemoveLibraryFolder = useCallback(
    async (folderUri: string) => {
      await updateSettings({
        libraryFolders: settings.libraryFolders.filter((item) => item !== folderUri),
      });
    },
    [settings.libraryFolders, updateSettings],
  );

  // Una voz guardada que ya no está instalada (o un id viejo de la voz en la
  // nube) se trata como automática.
  const selectedVoiceOption = useMemo(
    () => voiceOptions.find((option) => option.value === settings.defaultVoiceId) ?? null,
    [voiceOptions, settings.defaultVoiceId],
  );
  const pickerOptions = useMemo(() => [AUTO_VOICE_OPTION, ...voiceOptions], [voiceOptions]);

  const handleTestVoice = useCallback(async () => {
    if (isTestingVoice) return;
    setIsTestingVoice(true);
    try {
      const voiceId = selectedVoiceOption?.value ?? null;
      const language = voiceId ? primaryLanguage(voiceLanguages.get(voiceId) ?? 'es') : 'es';
      const sample = SAMPLE_TEXTS[language] ?? SAMPLE_TEXTS.es;
      const uri = await synthesizeSpeech(`sample--${voiceId ?? 'auto'}--${language}`, sample, voiceId, language);
      samplePlayerRef.current?.release();
      const player = createAudioPlayer({ uri });
      samplePlayerRef.current = player;
      player.play();
    } catch (error) {
      Alert.alert('No se pudo probar la voz', error instanceof Error ? error.message : 'El motor de voz no respondió.');
    } finally {
      setIsTestingVoice(false);
    }
  }, [isTestingVoice, selectedVoiceOption, voiceLanguages]);

  const handleOpenTtsSettings = useCallback(() => {
    Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => {
      Alert.alert('Ajustes de voz', 'Abrí Ajustes del teléfono → Accesibilidad → Salida de texto a voz.');
    });
  }, []);

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
          Dejá listo el lector una vez y después concentrate solo en abrir el documento y escuchar.
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

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Tema de lectura</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Color de la página dentro del lector (también en PDF). Se cambia rápido desde el menú del lector.
              </Text>
            </View>
            <AppButton
              label={READING_THEME_OPTIONS.find((option) => option.value === settings.readingTheme)?.label ?? 'Automático'}
              onPress={() => setIsThemePickerVisible(true)}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Recortar márgenes de los PDF</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Saca el borde blanco para que el texto se vea más grande en el teléfono.
              </Text>
            </View>
            <Switch
              value={settings.cropPdfMargins}
              onValueChange={(value) => {
                void updateSettings({ cropPdfMargins: value });
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
              <Text style={[styles.settingTitle, { color: colors.text }]}>Tamaño de fuente</Text>
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
              <Text style={[styles.settingTitle, { color: colors.text }]}>Voz de narración</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                {voiceError
                  ?? 'Voces instaladas en el teléfono, sin conexión. La que elijas se usa en los libros de su idioma.'}
              </Text>
            </View>
            <AppButton
              label={selectedVoiceOption?.label ?? AUTO_VOICE_OPTION.label}
              onPress={() => {
                void loadVoices(true);
                setIsVoicePickerVisible(true);
              }}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Probar y mejorar la voz</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                En los ajustes del teléfono podés instalar voces de más calidad o de otros idiomas.
              </Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton
                label={isTestingVoice ? '…' : 'Probar'}
                onPress={() => { void handleTestVoice(); }}
                variant="secondary"
                colors={colors}
                compact
                disabled={isTestingVoice}
              />
              <AppButton
                label="Voces"
                onPress={handleOpenTtsSettings}
                variant="ghost"
                colors={colors}
                compact
              />
            </View>
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
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Carpetas excluidas</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Subcarpetas que el escaneo saltea (manuales, facturas, lo que no sea para leer).
              </Text>
            </View>
            <AppButton
              label="Excluir"
              onPress={() => { void handleAddExcludedFolder(); }}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>
          {settings.excludedFolders.map((path) => (
            <View key={path}>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[styles.settingTitle, { color: colors.text }]} numberOfLines={1}>
                    {path.split(':').pop()}
                  </Text>
                </View>
                <AppButton
                  label="Quitar"
                  onPress={() => { void handleRemoveExcludedFolder(path); }}
                  variant="ghost"
                  colors={colors}
                  compact
                />
              </View>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Libros ocultos</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Los libros que borraste no se re-agregan solos. Restaurálos para que el escaneo los sume de nuevo.
              </Text>
            </View>
            <AppButton
              label="Restaurar"
              onPress={() => {
                void restoreIgnoredBooks().then((count) => {
                  Alert.alert(
                    'Libros restaurados',
                    count > 0
                      ? `${count} libro${count === 1 ? '' : 's'} volverán a aparecer al volver al inicio.`
                      : 'No había libros ocultos.',
                  );
                });
              }}
              variant="secondary"
              colors={colors}
              compact
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Borrar caché</Text>
              <Text style={[styles.settingHint, { color: colors.textMuted }]}>
                Texto procesado, páginas dibujadas y audio generado. NO borra libros ni tu progreso: al reabrir, cada libro se vuelve a procesar.
              </Text>
            </View>
            <AppButton
              label="Borrar"
              onPress={() => {
                Alert.alert(
                  '¿Borrar caché?',
                  'Se borra el texto procesado, las páginas dibujadas y el audio generado. Tus libros y tu progreso quedan intactos.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Borrar caché',
                      style: 'destructive',
                      onPress: () => {
                        void (async () => {
                          await documentAudioPlaybackService.stopAndUnload().catch(() => {});
                          await parsedDocumentRepository.clearAllParsedDocuments();
                          await clearAllAudio();
                          await clearAllPdfPages();
                          Alert.alert('Listo', 'Caché borrado. Abrí un libro y se re-procesa solo.');
                        })();
                      },
                    },
                  ],
                );
              }}
              variant="secondary"
              colors={colors}
              compact
              labelStyle={{ color: colors.danger }}
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
        <Text style={[styles.notesTitle, { color: colors.text }]}>Notas de esta versión</Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          Todo funciona sin conexión: el libro se procesa en el teléfono y la voz la genera el
          motor de texto a voz de Android.
        </Text>
        <Text style={[styles.noteText, { color: colors.textMuted }]}>
          Si un libro está en otro idioma, se usa sola la mejor voz instalada de ese idioma.
        </Text>
      </View>

      <OptionPickerModal
        title="Tema de lectura"
        visible={isThemePickerVisible}
        colors={colors}
        selectedValue={settings.readingTheme}
        options={READING_THEME_OPTIONS}
        onClose={() => setIsThemePickerVisible(false)}
        onSelect={(value) => {
          setIsThemePickerVisible(false);
          void updateSettings({ readingTheme: value as ReadingTheme });
        }}
      />

      <OptionPickerModal
        title="Voz de narración"
        visible={isVoicePickerVisible}
        colors={colors}
        selectedValue={selectedVoiceOption?.value ?? AUTO_VOICE}
        options={pickerOptions}
        onClose={() => setIsVoicePickerVisible(false)}
        onSelect={(value) => {
          setIsVoicePickerVisible(false);
          void updateSettings({ defaultVoiceId: value === AUTO_VOICE ? null : value });
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
