import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
import { AppSettingsProvider, useAppSettings } from '../src/hooks/useAppSettings';
import { authService } from '../src/services/authService';
import { premiumService } from '../src/services/premiumService';
import { initializeDatabase } from '../src/storage/database';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../src/storage/runtimeStateRepository';

function logBootRecoveryWarning(message: string, error: unknown) {
  const details = error instanceof Error ? error.message : String(error);
  console.warn(`[boot-recovery] ${message}: ${details}`);
}

function RootNavigator() {
  const { colors, isReady, settings } = useAppSettings();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Refs para distinguir transiciones reales (login/logout) de eventos
  // repetidos como TOKEN_REFRESHED, que NO deben navegar ni re-inicializar.
  const authenticatedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Carga inicial de sesión
    void authService.getSession().then(async (session) => {
      if (session?.user) {
        setIsAuthenticated(true);
        authenticatedUserIdRef.current = session.user.id;
        await premiumService.initialize(session.user.id);
      }
      // Sin sesión la app funciona igual (lectura, voz del sistema,
      // progreso). El login aparece recién al querer algo premium.
      setAuthChecked(true);
    });

    // Escucha cambios de auth (login / logout)
    const unsubscribe = authService.onAuthStateChange(async (session) => {
      if (session?.user) {
        const isNewLogin = authenticatedUserIdRef.current !== session.user.id;
        authenticatedUserIdRef.current = session.user.id;
        setIsAuthenticated(true);
        if (isNewLogin) {
          await premiumService.initialize(session.user.id);
          router.replace('/');
        }
      } else {
        const wasAuthenticated = authenticatedUserIdRef.current !== null;
        authenticatedUserIdRef.current = null;
        setIsAuthenticated(false);
        premiumService.teardown();
        if (wasAuthenticated) {
          router.replace('/');
        }
      }
    });

    return unsubscribe;
  }, []);

  if (!isReady || !authChecked) {
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
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontSize: 17, fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: 'Inicio' }} />
        <Stack.Screen name="reader" options={{ title: 'Lector' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
        <Stack.Screen name="chapter-context" options={{ title: 'Contexto del capitulo' }} />
        <Stack.Screen name="chat" options={{ title: 'Chat companion' }} />
        <Stack.Screen name="subscription" options={{ title: 'Premium' }} />
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
        const guard = await runtimeStateRepository.getReaderLoadGuard();
        if (guard) {
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
        <ActivityIndicator color="#4DB6D0" size="large" />
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
    backgroundColor: '#f7f4ee',
    paddingHorizontal: 24,
  },
  bootError: { backgroundColor: '#f6e8e6' },
  bootText: { color: '#253038', fontSize: 16 },
  bootTitle: { color: '#253038', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  bootSubtitle: { color: '#8f4a43', fontSize: 15, textAlign: 'center' },
});
