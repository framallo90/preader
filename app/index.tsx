import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { RecentDocumentCard } from '../src/components/RecentDocumentCard';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import {
  documentAudioPlaybackService,
  DocumentPlaybackSnapshot,
} from '../src/services/documentAudioPlaybackService';
import { removeBookCover } from '../src/services/bookMetadataService';
import { filePickerService } from '../src/services/filePickerService';
import { clearBookAudio } from '../src/services/openaiTtsService';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { bookRepository } from '../src/storage/bookRepository';
import { Book } from '../src/types/storage';

export default function HomeScreen() {
  const { colors, settings } = useAppSettings();
  const [recentDocuments, setRecentDocuments] = useState<Book[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [lastOpenedDocument, setLastOpenedDocument] = useState<Book | null>(null);
  const [activePlaybackDocument, setActivePlaybackDocument] = useState<Book | null>(null);
  const [playbackSnapshot, setPlaybackSnapshot] = useState<DocumentPlaybackSnapshot>(
    documentAudioPlaybackService.getSnapshot(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const hasAutoOpenedRef = useRef(false);

  const loadRecentDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const [recent, lastOpened] = await Promise.all([
        bookRepository.listRecentBooks(),
        bookRepository.getLastOpenedBook(),
      ]);
      const progressEntries = await Promise.all(
        recent.map(async (book) => {
          const p = await bookProgressRepository.getProgress(book.id);
          return [book.id, p?.percentage ?? 0] as [string, number];
        }),
      );
      const newProgressMap = new Map(progressEntries.filter(([, pct]) => pct > 0));
      setRecentDocuments(recent);
      setProgressMap(newProgressMap);
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
    action({ pathname: '/reader', params: { documentId } });
  }, []);

  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (!settings.reopenLastDocumentOnLaunch) return;
    void bookRepository.getLastOpenedBook().then((book) => {
      if (book && !hasAutoOpenedRef.current) {
        hasAutoOpenedRef.current = true;
        openReader(book.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.reopenLastDocumentOnLaunch]);

  useEffect(() => {
    let isMounted = true;
    let requestId = 0;
    const syncPlaybackDocument = async (snapshot: DocumentPlaybackSnapshot) => {
      const currentRequestId = ++requestId;
      setPlaybackSnapshot(snapshot);
      if (!snapshot.documentId) {
        if (isMounted) setActivePlaybackDocument(null);
        return;
      }
      const storedDocument = await bookRepository.getBookById(snapshot.documentId);
      if (isMounted && currentRequestId === requestId) setActivePlaybackDocument(storedDocument);
    };
    void syncPlaybackDocument(documentAudioPlaybackService.getSnapshot());
    const unsubscribe = documentAudioPlaybackService.subscribe((snapshot) => {
      void syncPlaybackDocument(snapshot);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleOpenDocument = useCallback(async () => {
    setIsImporting(true);
    try {
      const selectedDocument = await filePickerService.pickDocument();
      if (!selectedDocument) return;
      await bookRepository.saveBook(selectedDocument);
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
    (document: Book) => {
      Alert.alert(
        'Eliminar libro',
        'Se borrara de recientes, progreso y cache local de audio.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  if (playbackSnapshot.documentId === document.id) {
                    await documentAudioPlaybackService.stopAndUnload();
                  }
                  await clearBookAudio(document.id);
                  await removeBookCover(document.id);
                  await filePickerService.deleteStoredDocument(document.uri);
                  await bookRepository.removeBook(document.id);
                  await loadRecentDocuments();
                } catch (error) {
                  Alert.alert(
                    'No se pudo eliminar',
                    error instanceof Error ? error.message : 'No se pudo limpiar el documento local.',
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [loadRecentDocuments, playbackSnapshot.documentId],
  );

  const playbackCardVisible = Boolean(
    activePlaybackDocument && (playbackSnapshot.isPlaying || playbackSnapshot.isPreparing),
  );

  const playbackStatusLabel = useMemo(() => {
    if (playbackSnapshot.isPreparing) return 'Preparando audio';
    if (playbackSnapshot.isPlaying) return 'Reproduciendo ahora';
    return 'Listo para seguir';
  }, [playbackSnapshot.isPlaying, playbackSnapshot.isPreparing]);

  return (
    <Screen colors={colors} scroll>
      <Stack.Screen options={{ title: 'Inicio' }} />
      <View style={[styles.heroCard, { backgroundColor: colors.readerSurface, borderColor: colors.border }]}>
        <Text style={[styles.heroEyebrow, { color: colors.primary }]}>Lector personal offline</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>Escucha tus PDFs con una interfaz calma</Text>
        <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
          Abre un PDF, escucha el texto en voz alta y retoma justo donde lo dejaste sin depender de la nube.
        </Text>
        <View style={styles.heroActions}>
          <AppButton
            label={isImporting ? 'Abriendo...' : 'Abrir archivo'}
            onPress={() => { void handleOpenDocument(); }}
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

      {playbackCardVisible && activePlaybackDocument ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>{playbackStatusLabel}</Text>
          <Text style={[styles.continueTitle, { color: colors.text }]}>{activePlaybackDocument.title ?? activePlaybackDocument.name}</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
            El audio sigue vivo fuera del lector. Puedes volver a esta pantalla o controlarlo desde la notificacion del sistema.
          </Text>
          <AppButton label="Volver al lector" onPress={() => openReader(activePlaybackDocument.id)} colors={colors} fullWidth />
        </View>
      ) : null}

      {lastOpenedDocument ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>Seguir leyendo</Text>
          <Text style={[styles.continueTitle, { color: colors.text }]}>{lastOpenedDocument.title ?? lastOpenedDocument.name}</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
            Retoma el documento mas reciente desde el ultimo bloque guardado, sin volver a importarlo.
          </Text>
          <AppButton label="Continuar lectura" onPress={() => openReader(lastOpenedDocument.id)} colors={colors} fullWidth />
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
        <View style={[styles.emptyState, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Todavia no hay documentos</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Empieza con un PDF de texto. Si el archivo es un escaneo sin texto embebido, la app lo va a informar.
          </Text>
        </View>
      ) : null}

      {recentDocuments.map((document) => (
        <RecentDocumentCard
          key={document.id}
          document={document}
          colors={colors}
          progress={progressMap.get(document.id)}
          onOpen={() => openReader(document.id)}
          onDelete={() => confirmDeleteDocument(document)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 12 },
  heroEyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTitle: { fontSize: 29, fontWeight: '800', lineHeight: 35 },
  heroSubtitle: { fontSize: 16, lineHeight: 24 },
  heroActions: { gap: 10, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 10 },
  cardEyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  sectionCount: { fontSize: 13 },
  sectionHint: { fontSize: 14, lineHeight: 20 },
  continueTitle: { fontSize: 18, fontWeight: '700' },
  emptyState: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptySubtitle: { fontSize: 14, lineHeight: 20 },
});
