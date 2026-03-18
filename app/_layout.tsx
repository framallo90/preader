import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppSettingsProvider, useAppSettings } from '../src/hooks/useAppSettings';
import { initializeDatabase } from '../src/storage/database';

function RootNavigator() {
  const { colors, isReady, settings } = useAppSettings();

  if (!isReady) {
    return (
      <View style={[styles.bootContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.bootText, { color: colors.text }]}>Cargando ajustes...</Text>
      </View>
    );
  }

  return (
    <>
        <StatusBar style={settings.darkMode ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            animation: 'slide_from_right',
            headerStyle: {
              backgroundColor: colors.background,
            },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            headerTitleStyle: {
              fontSize: 17,
              fontWeight: '700',
            },
            contentStyle: {
              backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Inicio' }} />
        <Stack.Screen name="reader" options={{ title: 'Lector' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void initializeDatabase()
      .then(() => {
        if (isMounted) {
          setIsDatabaseReady(true);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setBootError(error instanceof Error ? error.message : 'No se pudo abrir la base local.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (bootError) {
    return (
      <View style={[styles.bootContainer, styles.bootError]}>
        <Text style={styles.bootTitle}>No se pudo iniciar la app</Text>
        <Text style={styles.bootSubtitle}>{bootError}</Text>
      </View>
    );
  }

  if (!isDatabaseReady) {
    return (
      <View style={styles.bootContainer}>
        <ActivityIndicator color="#4DB6D0" size="large" />
        <Text style={styles.bootText}>Preparando base local...</Text>
      </View>
    );
  }

  return (
    <AppSettingsProvider>
      <RootNavigator />
    </AppSettingsProvider>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f7f4ee',
    paddingHorizontal: 24,
  },
  bootError: {
    backgroundColor: '#f6e8e6',
  },
  bootText: {
    color: '#253038',
    fontSize: 16,
  },
  bootTitle: {
    color: '#253038',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  bootSubtitle: {
    color: '#8f4a43',
    fontSize: 15,
    textAlign: 'center',
  },
});
