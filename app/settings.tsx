import { createAudioPlayer } from 'expo-audio';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { Screen } from '../src/components/Screen';
import { Chip, IconButton, Row, RowValue, Section, Stepper } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';

import { getDisplayNameFromSafUri, requestLibraryFolder, restoreIgnoredBooks } from '../src/services/libraryScanService';
import { clearAllPdfPages } from '../src/services/pdfLocalService';
import { clearAllAudio, listVoices, synthesizeSpeech } from '../src/services/systemTtsService';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { documentAudioPlaybackService } from '../src/services/documentAudioPlaybackService';
import { clampRounded } from '../src/utils/math';
import { MAX_RATE, MIN_RATE, decreaseRate, formatRate, increaseRate } from '../src/utils/playbackRate';
import { MAX_TEXT_MARGIN, MIN_TEXT_MARGIN, ReadingTheme, TEXT_MARGIN_STEP } from '../src/types/storage';
import { getSafFolderPath } from '../src/utils/safPaths';
import { VoiceOption, buildVoiceOptions, primaryLanguage } from '../src/utils/voices';

const AUTO_VOICE = 'auto';
const AUTO_VOICE_OPTION: VoiceOption = {
  value: AUTO_VOICE,
  label: 'Automática',
  description: 'Elige sola la mejor voz instalada según el idioma de cada libro.',
};
const READING_THEME_OPTIONS: { value: ReadingTheme; label: string; description: string }[] = [
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

const APP_VERSION = Constants.expoConfig?.version ?? '2.0.0';
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

  // La prueba de voz crea el player DESPUÉS de sintetizar: si para entonces la
  // pantalla ya se cerró, el player nacería sonando solo y sin nadie que lo suelte.
  const isScreenMountedRef = useRef(true);
  useEffect(() => {
    void loadVoices(false);
    return () => {
      isScreenMountedRef.current = false;
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
      if (!isScreenMountedRef.current) return; // saliste de Ajustes mientras sintetizaba
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
    async (direction: 1 | -1) => {
      await updateSettings({
        defaultRate: direction > 0 ? increaseRate(settings.defaultRate) : decreaseRate(settings.defaultRate),
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

  const handleClearCache = useCallback(() => {
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
  }, []);

  const handleRestoreHidden = useCallback(() => {
    void restoreIgnoredBooks().then((count) => {
      Alert.alert(
        'Libros restaurados',
        count > 0
          ? `${count} libro${count === 1 ? '' : 's'} volverán a aparecer al volver al inicio.`
          : 'No había libros ocultos.',
      );
    });
  }, []);

  const themeLabel = READING_THEME_OPTIONS.find((option) => option.value === settings.readingTheme)?.label ?? 'Automático';
  const switchColors = { trackColor: { false: colors.border, true: colors.primary }, thumbColor: colors.surface };

  return (
    <Screen colors={colors} scroll underHeader contentContainerStyle={styles.screenContent}>
      <Stack.Screen options={{ title: 'Ajustes' }} />

      <Section title="Texto" colors={colors} hint="Cómo se ve el texto en EPUB, TXT, DOCX y en los PDF leídos como texto corrido.">
        <Row
          icon="color-palette-outline"
          title="Tema de lectura"
          subtitle="Color de la página, también en PDF"
          colors={colors}
          onPress={() => setIsThemePickerVisible(true)}
          right={<RowValue colors={colors}>{themeLabel}</RowValue>}
        />
        <Row
          icon="text-outline"
          title="Tamaño de letra"
          subtitle="Para EPUB, TXT y DOCX"
          colors={colors}
          right={
            <Stepper
              value={`${settings.fontSize}`}
              onDecrease={() => void updateFontSize(-1)}
              onIncrease={() => void updateFontSize(1)}
              canDecrease={settings.fontSize > MIN_FONT_SIZE}
              canIncrease={settings.fontSize < MAX_FONT_SIZE}
              colors={colors}
            />
          }
        />
        <Row
          icon="code-outline"
          title="Márgenes"
          subtitle="Espacio a los costados del texto"
          colors={colors}
          right={
            <Stepper
              value={`${settings.textMargin}`}
              onDecrease={() => void updateSettings({ textMargin: Math.max(MIN_TEXT_MARGIN, settings.textMargin - TEXT_MARGIN_STEP) })}
              onIncrease={() => void updateSettings({ textMargin: Math.min(MAX_TEXT_MARGIN, settings.textMargin + TEXT_MARGIN_STEP) })}
              canDecrease={settings.textMargin > MIN_TEXT_MARGIN}
              canIncrease={settings.textMargin < MAX_TEXT_MARGIN}
              colors={colors}
            />
          }
        />
        <Row
          icon="resize-outline"
          title="Interlineado"
          subtitle="Espacio entre renglones del modo texto"
          colors={colors}
          right={
            <Stepper
              value={settings.lineHeight.toFixed(1)}
              onDecrease={() => void updateSettings({ lineHeight: Math.max(1.3, Math.round((settings.lineHeight - 0.1) * 10) / 10) })}
              onIncrease={() => void updateSettings({ lineHeight: Math.min(2.0, Math.round((settings.lineHeight + 0.1) * 10) / 10) })}
              canDecrease={settings.lineHeight > 1.31}
              canIncrease={settings.lineHeight < 1.99}
              colors={colors}
            />
          }
        />
        <Row
          icon="language-outline"
          title="Tipografía"
          colors={colors}
          right={
            <View style={styles.chipRow}>
              <Chip label="Sans" active={settings.fontFamily === 'sans'} onPress={() => { void updateSettings({ fontFamily: 'sans' }); }} colors={colors} />
              <Chip label="Serif" active={settings.fontFamily === 'serif'} onPress={() => { void updateSettings({ fontFamily: 'serif' }); }} colors={colors} />
            </View>
          }
        />
        <Row
          icon="menu-outline"
          title="Justificar el texto"
          colors={colors}
          right={<Switch value={settings.justifyText} onValueChange={(value) => { void updateSettings({ justifyText: value }); }} {...switchColors} />}
          last
        />
      </Section>

      <Section title="Páginas y gestos" colors={colors} hint="Para los PDF y los cómics, que se leen por página.">
        <Row
          icon="reorder-four-outline"
          title="Leer los PDF como texto corrido"
          subtitle="En vez de por páginas (solo los que tienen texto)"
          colors={colors}
          right={<Switch value={settings.pdfAsText} onValueChange={(value) => { void updateSettings({ pdfAsText: value }); }} {...switchColors} />}
        />
        <Row
          icon="crop-outline"
          title="Recortar márgenes de los PDF"
          subtitle="Saca el borde blanco: el texto se ve más grande"
          colors={colors}
          right={<Switch value={settings.cropPdfMargins} onValueChange={(value) => { void updateSettings({ cropPdfMargins: value }); }} {...switchColors} />}
        />
        <Row
          icon="swap-horizontal"
          title="Pasar de costado"
          subtitle="Una página por vez en PDF y cómics, como pasar una hoja"
          colors={colors}
          right={<Switch value={settings.horizontalPages} onValueChange={(value) => { void updateSettings({ horizontalPages: value }); }} {...switchColors} />}
        />
        <Row
          icon="swap-horizontal-outline"
          title="Tocar los bordes pasa de página"
          subtitle="En PDF y cómics; el centro sigue mostrando y ocultando los controles"
          colors={colors}
          right={<Switch value={settings.tapEdgesTurnPage} onValueChange={(value) => { void updateSettings({ tapEdgesTurnPage: value }); }} {...switchColors} />}
        />
        <Row
          icon="volume-medium-outline"
          title="Los botones de volumen pasan de página"
          subtitle="Sólo con un libro abierto; arriba vuelve, abajo avanza"
          colors={colors}
          right={<Switch value={settings.volumeKeysTurnPage} onValueChange={(value) => { void updateSettings({ volumeKeysTurnPage: value }); }} {...switchColors} />}
          last
        />
      </Section>

      <Section title="Pantalla y arranque" colors={colors}>
        <Row
          icon="sunny-outline"
          title="Pantalla encendida al leer"
          subtitle="No se apaga sola mientras el libro está abierto"
          colors={colors}
          right={<Switch value={settings.keepScreenAwakeWhileReading} onValueChange={(value) => { void updateSettings({ keepScreenAwakeWhileReading: value }); }} {...switchColors} />}
        />
        <Row
          icon="book-outline"
          title="Reabrir el último libro al iniciar"
          subtitle="Te ahorra un toque si seguís siempre el mismo"
          colors={colors}
          right={<Switch value={settings.reopenLastDocumentOnLaunch} onValueChange={(value) => { void updateSettings({ reopenLastDocumentOnLaunch: value }); }} {...switchColors} />}
        />
        <Row
          icon="moon-outline"
          title="Modo oscuro de la app"
          subtitle="Inicio y ajustes; el lector tiene su propio tema"
          colors={colors}
          right={<Switch value={settings.darkMode} onValueChange={(value) => { void updateSettings({ darkMode: value }); }} {...switchColors} />}
          last
        />
      </Section>

      <Section title="Voz" colors={colors} hint={voiceError ?? undefined}>
        <Row
          icon="mic-outline"
          title="Voz"
          subtitle={selectedVoiceOption?.description ?? AUTO_VOICE_OPTION.description}
          colors={colors}
          onPress={() => setIsVoicePickerVisible(true)}
          right={<RowValue colors={colors}>{selectedVoiceOption?.label ?? 'Automática'}</RowValue>}
        />
        <Row
          icon="speedometer-outline"
          title="Velocidad"
          subtitle="La de arranque. Si la cambiás desde un libro, queda sólo para ese libro"
          colors={colors}
          right={
            <Stepper
              value={formatRate(settings.defaultRate)}
              onDecrease={() => void updateRate(-1)}
              onIncrease={() => void updateRate(1)}
              canDecrease={settings.defaultRate > MIN_RATE + 0.001}
              canIncrease={settings.defaultRate < MAX_RATE - 0.001}
              colors={colors}
            />
          }
        />
        <Row
          icon="git-branch-outline"
          title="Anunciar los capítulos"
          subtitle="Dice el capítulo al empezar uno; si retomás en el medio, no dice nada"
          colors={colors}
          right={<Switch value={settings.announceChapters} onValueChange={(value) => { void updateSettings({ announceChapters: value }); }} {...switchColors} />}
        />
        <Row
          icon="volume-high-outline"
          title="Probar la voz"
          subtitle="Escuchá una frase con la voz y velocidad elegidas"
          colors={colors}
          onPress={() => { void handleTestVoice(); }}
          right={<AppButton label={isTestingVoice ? '…' : 'Probar'} icon="play" onPress={() => { void handleTestVoice(); }} variant="secondary" colors={colors} compact disabled={isTestingVoice} />}
        />
        <Row
          icon="download-outline"
          title="Instalar más voces"
          subtitle="Abre los ajustes de texto a voz del teléfono (voces de más calidad u otros idiomas)"
          colors={colors}
          onPress={handleOpenTtsSettings}
          last
        />
      </Section>

      <Section
        title="Biblioteca"
        colors={colors}
        hint="Los libros de las carpetas elegidas aparecen solos en el Inicio, sin copiarlos."
      >
        <Row
          icon="folder-open-outline"
          title="Carpetas escaneadas"
          subtitle={settings.libraryFolders.length === 0 ? 'Ninguna todavía' : `${settings.libraryFolders.length} carpeta${settings.libraryFolders.length === 1 ? '' : 's'}`}
          colors={colors}
          right={<AppButton label="Agregar" icon="add" onPress={() => { void handleAddLibraryFolder(); }} variant="secondary" colors={colors} compact />}
        />
        {settings.libraryFolders.map((folderUri) => (
          <Row
            key={folderUri}
            title={getSafFolderPath(folderUri)?.replace(/^primary:/, '') ?? getDisplayNameFromSafUri(folderUri)}
            colors={colors}
            right={<IconButton name="close-circle-outline" label="Quitar carpeta" onPress={() => { void handleRemoveLibraryFolder(folderUri); }} colors={colors} />}
          />
        ))}
        <Row
          icon="eye-off-outline"
          title="Carpetas excluidas"
          subtitle="Subcarpetas que el escaneo saltea (manuales, facturas…)"
          colors={colors}
          right={<AppButton label="Excluir" icon="remove-circle-outline" onPress={() => { void handleAddExcludedFolder(); }} variant="secondary" colors={colors} compact />}
        />
        {settings.excludedFolders.map((path) => (
          <Row
            key={path}
            title={path}
            colors={colors}
            right={<IconButton name="close-circle-outline" label="Quitar exclusión" onPress={() => { void handleRemoveExcludedFolder(path); }} colors={colors} />}
          />
        ))}
        <Row
          icon="chatbox-ellipses-outline"
          title="Mis notas y citas"
          subtitle="Todo lo que guardaste, de todos los libros, buscable"
          colors={colors}
          onPress={() => router.push('/notes')}
        />
        <Row
          icon="refresh-outline"
          title="Libros ocultos"
          subtitle="Los que eliminaste pero siguen en una carpeta escaneada"
          colors={colors}
          right={<AppButton label="Restaurar" onPress={handleRestoreHidden} variant="secondary" colors={colors} compact />}
          last
        />
      </Section>

      <Section title="Almacenamiento" colors={colors}>
        <Row
          icon="trash-outline"
          title="Borrar caché"
          subtitle="Texto procesado, páginas dibujadas y audio generado. No borra libros ni progreso."
          colors={colors}
          onPress={handleClearCache}
          danger
          last
        />
      </Section>

      <Section title="Acerca de" colors={colors}>
        <Row
          icon="book"
          title="Bardo"
          subtitle={`Versión ${APP_VERSION} · Lector y narrador de libros, 100 % en el teléfono`}
          colors={colors}
        />
        <Row
          icon="shield-checkmark-outline"
          title="Sin conexión, sin cuentas"
          subtitle="Los libros se procesan en el teléfono y la voz la genera el motor de texto a voz de Android. Nada sale del dispositivo."
          colors={colors}
        />
        <Row
          icon="documents-outline"
          title="Formatos"
          subtitle="PDF, EPUB, TXT, DOCX y cómics CBZ, CBR, CB7 y CBT"
          colors={colors}
          last
        />
      </Section>

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
    gap: 22,
  },
  chipRow: { flexDirection: 'row', gap: 6 },
});
