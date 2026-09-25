import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
import { AppSettingsProvider, useAppSettings } from '../src/hooks/useAppSettings';
import { initializeDatabase } from '../src/storage/database';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';
import { lightColors } from '../src/utils/theme';

function logBootRecoveryWarning(message: string, error: unknown) {
  const details = error instanceof Error ? error.message : String(error);
  console.warn(`[boot-recovery] ${message}: ${details}`);
}

function RootNavigator() {
  const { colors, isReady, settings } = useAppSettings();

  if (!isReady) {
    return (
      <View style={[styles.bootContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.bootText, { color: colors.text }]}>Cargando...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={settings.darkMode ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerShadowVisible: false,
          headerTitleStyle: { fontSize: 17, fontWeight: '700', color: colors.text },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Bardo', headerShown: false }} />
        <Stack.Screen name="reader" options={{ title: 'Lector' }} />
        <Stack.Screen name="book" options={{ title: 'Sobre este libro' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
        <Stack.Screen name="notes" options={{ title: 'Mis notas' }} />
        <Stack.Screen name="pronunciation" options={{ title: 'Pronunciación' }} />
        <Stack.Screen name="stats" options={{ title: 'Estadísticas' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const prepareAndRecover = async () => {
      try {
        await initializeDatabase();
      } catch (error) {
        if (isMounted) {
          setBootError(
            error instanceof Error ? error.message : 'No se pudo preparar la base de datos.',
          );
        }
        return;
      }

      try {
        await parsedDocumentRepository.ensureCacheVersion();
      } catch (error) {
        logBootRecoveryWarning('No se pudo verificar la versión del caché', error);
      }

      try {
        const guard = await runtimeStateRepository.getReaderLoadGuard();
        if (guard) {
          runtimeStateRepository.markBootRecovered();
          try { await runtimeStateRepository.clearReaderLoadGuard(); } catch (error) {
            logBootRecoveryWarning('No se pudo limpiar readerLoadGuard', error);
          }
          try { await parsedDocumentRepository.removeParsedDocument(guard.documentId); } catch (error) {
            logBootRecoveryWarning(`No se pudo borrar la cache del documento ${guard.documentId}`, error);
          }
        }
      } catch (error) {
        logBootRecoveryWarning('No se pudo verificar el estado de recuperacion', error);
      } finally {
        if (isMounted) setIsDatabaseReady(true);
      }
    };

    void prepareAndRecover();
    return () => { isMounted = false; };
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
        <ActivityIndicator color={lightColors.primary} size="large" />
        <Text style={styles.bootText}>Preparando base local...</Text>
      </View>
    );
  }

  return (
    <AppErrorBoundary>
      <AppSettingsProvider>
        <RootNavigator />
      </AppSettingsProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: lightColors.background,
    paddingHorizontal: 24,
  },
  bootError: { backgroundColor: lightColors.warmSoft },
  bootText: { color: lightColors.text, fontSize: 16 },
  bootTitle: { color: lightColors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  bootSubtitle: { color: lightColors.danger, fontSize: 15, textAlign: 'center' },
});
