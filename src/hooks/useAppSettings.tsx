import * as SystemUI from 'expo-system-ui';
import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { settingsRepository } from '../storage/settingsRepository';
import { AppSettings, DEFAULT_SETTINGS } from '../types/storage';
import { ThemeColors, getThemeColors } from '../utils/theme';

type AppSettingsContextValue = {
  settings: AppSettings;
  colors: ThemeColors;
  isReady: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isReady, setIsReady] = useState(false);
  const settingsRef = useRef(DEFAULT_SETTINGS);

  useEffect(() => {
    let isMounted = true;

    void settingsRepository
      .loadSettings()
      .then((loadedSettings) => {
        if (!isMounted) {
          return;
        }

        settingsRef.current = loadedSettings;
        setSettings(loadedSettings);
      })
      .finally(() => {
        if (isMounted) {
          setIsReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const nextSettings = { ...settingsRef.current, ...patch };

    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    await settingsRepository.saveSettings(patch);
  }, []);

  const colors = useMemo(() => getThemeColors(settings.darkMode), [settings.darkMode]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  const value = useMemo(
    () => ({
      settings,
      colors,
      isReady,
      updateSettings,
    }),
    [colors, isReady, settings, updateSettings],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error('useAppSettings debe usarse dentro de AppSettingsProvider.');
  }

  return context;
}
