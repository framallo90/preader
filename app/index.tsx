import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { RecentDocumentCard } from '../src/components/RecentDocumentCard';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { filePickerService } from '../src/services/filePickerService';
import { recentFilesRepository } from '../src/storage/recentFilesRepository';
import { StoredDocument } from '../src/types/storage';

export default function HomeScreen() {
  const { colors, settings, isReady } = useAppSettings();
  const [recentDocuments, setRecentDocuments] = useState<StoredDocument[]>([]);
  const [lastOpenedDocument, setLastOpenedDocument] = useState<StoredDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const autoResumeAttemptedRef = useRef(false);

  const loadRecentDocuments = useCallback(async () => {
    setIsLoading(true);

    try {
      const [recent, lastOpened] = await Promise.all([
        recentFilesRepository.listRecentDocuments(),
        recentFilesRepository.getLastOpenedDocument(),
      ]);

      setRecentDocuments(recent);
      setLastOpenedDocument(lastOpened);
    } catch (error) {
      Alert.alert(
        'No se pudieron cargar los recientes',
        error instanceof Error ? error.message : 'Revisa el almacenamiento local e intenta de nuevo.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRecentDocuments();
    }, [loadRecentDocuments]),
  );

  const openReader = useCallback((documentId: string, replace = false) => {
    const action = replace ? router.replace : router.push;

    action({
      pathname: '/reader',
      params: { documentId },
    });
  }, []);

  useEffect(() => {
    if (!isReady || isLoading || autoResumeAttemptedRef.current) {
      return;
    }

    autoResumeAttemptedRef.current = true;

    if (settings.reopenLastDocumentOnLaunch && lastOpenedDocument) {
      openReader(lastOpenedDocument.id, true);
    }
  }, [isLoading, isReady, lastOpenedDocument, openReader, settings.reopenLastDocumentOnLaunch]);

  const handleOpenDocument = useCallback(async () => {
    setIsImporting(true);

    try {
      const selectedDocument = await filePickerService.pickPdfDocument();

      if (!selectedDocument) {
        return;
      }

      await recentFilesRepository.saveDocument(selectedDocument);
      openReader(selectedDocument.id);
    } catch (error) {
      Alert.alert(
        'No se pudo abrir el archivo',
        error instanceof Error ? error.message : 'Elige otro PDF e intenta de nuevo.',
      );
    } finally {
      setIsImporting(false);
    }
  }, [openReader]);

  const confirmDeleteDocument = useCallback(
    (document: StoredDocument) => {
      Alert.alert(
        'Eliminar documento',
        'Se borrara de recientes, progreso y cache local de lectura. El archivo importado dentro de la app tambien se elimina.',
        [
          {
            text: 'Cancelar',
            style: 'cancel',
          },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await filePickerService.deleteStoredDocument(document.uri);
                  await recentFilesRepository.removeDocument(document.id);
                  await loadRecentDocuments();
                } catch (error) {
                  Alert.alert(
                    'No se pudo eliminar',
                    error instanceof Error
                      ? error.message
                      : 'No se pudo limpiar el documento local.',
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [loadRecentDocuments],
  );

  return (
    <Screen colors={colors} scroll>
      <Stack.Screen options={{ title: 'Inicio' }} />

      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: colors.readerSurface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.heroEyebrow, { color: colors.primary }]}>Lector personal offline</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>Escucha tus PDFs con una interfaz calma</Text>
        <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
          Abre un PDF, escucha el texto en voz alta y retoma justo donde lo dejaste sin depender de la nube.
        </Text>

        <View style={styles.heroActions}>
          <AppButton
            label={isImporting ? 'Abriendo...' : 'Abrir archivo'}
            onPress={() => {
              void handleOpenDocument();
            }}
            disabled={isImporting}
            colors={colors}
            fullWidth
          />
          <AppButton
            label="Ajustes"
            onPress={() => router.push('/settings')}
            variant="secondary"
            colors={colors}
            fullWidth
          />
        </View>
      </View>

      {lastOpenedDocument ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>Seguir leyendo</Text>
          <Text style={[styles.continueTitle, { color: colors.text }]}>{lastOpenedDocument.name}</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
            Retoma el documento mas reciente desde el ultimo bloque guardado, sin volver a importarlo.
          </Text>
          <AppButton
            label="Continuar lectura"
            onPress={() => openReader(lastOpenedDocument.id)}
            colors={colors}
            fullWidth
          />
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recientes</Text>
        {!isLoading && recentDocuments.length > 0 ? (
          <Text style={[styles.sectionCount, { color: colors.textMuted }]}>
            {recentDocuments.length} archivo{recentDocuments.length === 1 ? '' : 's'}
          </Text>
        ) : null}
        {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {!isLoading && recentDocuments.length === 0 ? (
        <View
          style={[
            styles.emptyState,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Todavia no hay documentos</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Empieza con un PDF de texto. Si el archivo es un escaneo sin texto embebido, la app lo va
            a informar.
          </Text>
        </View>
      ) : null}

      {recentDocuments.map((document) => (
        <RecentDocumentCard
          key={document.id}
          document={document}
          colors={colors}
          onOpen={() => openReader(document.id)}
          onDelete={() => confirmDeleteDocument(document)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 29,
    fontWeight: '800',
    lineHeight: 35,
  },
  heroSubtitle: {
    fontSize: 16,
    lineHeight: 24,
  },
  heroActions: {
    gap: 10,
    marginTop: 6,
  },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  cardEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sectionCount: {
    fontSize: 13,
  },
  sectionHint: {
    fontSize: 14,
    lineHeight: 20,
  },
  continueTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
});
