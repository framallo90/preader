import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { BookGridItem } from '../src/components/BookGridItem';
import { OptionPickerModal } from '../src/components/OptionPickerModal';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import {
  documentAudioPlaybackService,
  DocumentPlaybackSnapshot,
} from '../src/services/documentAudioPlaybackService';
import { removeBookCover } from '../src/services/bookMetadataService';
import { addIgnoredBook, clearIgnoredBook, getDisplayNameFromSafUri, getIgnoredBooksCount, restoreIgnoredBooks, scanLibraryFolders } from '../src/services/libraryScanService';
import { compareBooksNaturally, getDisplayTitle } from '../src/utils/bookDisplay';
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
  const [ignoredCount, setIgnoredCount] = useState(0);
  // Carpetas de biblioteca como secciones expandibles + selector Leer/Escuchar.
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [pendingBook, setPendingBook] = useState<Book | null>(null);
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
      setIgnoredCount(await getIgnoredBooksCount());
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
      void (async () => {
        // Biblioteca por descubrimiento: los libros nuevos en las carpetas
        // autorizadas se agregan solos antes de refrescar la lista.
        if (settings.libraryFolders.length > 0) {
          try {
            await scanLibraryFolders(settings.libraryFolders);
          } catch {
            // El escaneo nunca debe romper el Home.
          }
        }
        await loadRecentDocuments();
      })();
    }, [loadRecentDocuments, settings.libraryFolders]),
  );

  const openReader = useCallback((documentId: string, replace = false, mode?: 'read' | 'listen') => {
    console.log('[home] openReader', documentId.slice(0, 12), mode ?? '(sin modo)');
    const action = replace ? router.replace : router.push;
    action({ pathname: '/reader', params: mode ? { documentId, mode } : { documentId } });
  }, []);

  const openChooser = useCallback((book: Book) => {
    setPendingBook(book);
  }, []);

  // Restaurar ocultos + re-escanear + refrescar, todo de una.
  const handleRestoreHidden = useCallback(async () => {
    await restoreIgnoredBooks();
    if (settings.libraryFolders.length > 0) {
      try { await scanLibraryFolders(settings.libraryFolders); } catch { /* no romper el Home */ }
    }
    await loadRecentDocuments();
  }, [settings.libraryFolders, loadRecentDocuments]);

  // Agrupa los libros por carpeta. El nombre de los escaneados trae el prefijo
  // de la carpeta ("Game of saga/…"), que es el criterio confiable; el match
  // por URI queda de refuerzo. Orden natural (2 antes que 10) dentro de cada grupo.
  const librarySections = useMemo(() => {
    const sections = settings.libraryFolders.map((folderUri) => {
      const treeId = folderUri.split('/tree/')[1] ?? '';
      const folderName = getDisplayNameFromSafUri(folderUri);
      const books = recentDocuments
        .filter(
          (book) =>
            book.name.startsWith(`${folderName}/`) ||
            (treeId !== '' && book.uri.includes(`/tree/${treeId}/`)),
        )
        .sort(compareBooksNaturally);
      return { folderUri, name: folderName, books };
    });
    const grouped = new Set(sections.flatMap((section) => section.books.map((b) => b.id)));
    const ungrouped = recentDocuments
      .filter((book) => !grouped.has(book.id))
      .sort(compareBooksNaturally);
    return { sections, ungrouped };
  }, [settings.libraryFolders, recentDocuments]);

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
      // Importarlo a mano anula un borrado previo del mismo contenido.
      await clearIgnoredBook(selectedDocument.id);
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
                  // Si el archivo sigue en una carpeta escaneada, que el
                  // próximo escaneo no lo vuelva a agregar solo.
                  await addIgnoredBook(document.id);
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

  const pendingProgress = pendingBook ? (progressMap.get(pendingBook.id) ?? 0) : 0;

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
      {recentDocuments.length === 0 ? (
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
      ) : (
        // Con biblioteca ya armada, el hero gigante sobra: fila compacta.
        <View style={styles.heroCompact}>
          <View style={{ flex: 1 }}>
            <AppButton
              label={isImporting ? 'Abriendo...' : '+ Abrir archivo'}
              onPress={() => { void handleOpenDocument(); }}
              disabled={isImporting}
              colors={colors}
              compact
              fullWidth
            />
          </View>
          <AppButton
            label="Ajustes"
            onPress={() => router.push('/settings')}
            variant="secondary"
            colors={colors}
            compact
          />
        </View>
      )}

      {playbackCardVisible && activePlaybackDocument ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>{playbackStatusLabel}</Text>
          <Text style={[styles.continueTitle, { color: colors.text }]}>{getDisplayTitle(activePlaybackDocument)}</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
            El audio sigue vivo fuera del lector. Puedes volver a esta pantalla o controlarlo desde la notificacion del sistema.
          </Text>
          <AppButton label="Volver al lector" onPress={() => openReader(activePlaybackDocument.id)} colors={colors} fullWidth />
          <AppButton
            label="Detener"
            onPress={() => { void documentAudioPlaybackService.stopAndUnload(); }}
            variant="secondary"
            colors={colors}
            fullWidth
          />
        </View>
      ) : null}

      {lastOpenedDocument ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardEyebrow, { color: colors.primary }]}>Seguir leyendo</Text>
          <Text style={[styles.continueTitle, { color: colors.text }]}>{getDisplayTitle(lastOpenedDocument)}</Text>
          <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
            Retoma el documento mas reciente desde el ultimo bloque guardado, sin volver a importarlo.
          </Text>
          <AppButton label="Continuar" onPress={() => openReader(lastOpenedDocument.id)} colors={colors} fullWidth />
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

      {ignoredCount > 0 ? (
        <View style={[styles.hiddenBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Text style={[styles.hiddenBannerText, { color: colors.textMuted }]}>
            {ignoredCount} libro{ignoredCount === 1 ? '' : 's'} oculto{ignoredCount === 1 ? '' : 's'} (borrados antes)
          </Text>
          <AppButton
            label="Restaurar"
            onPress={() => { void handleRestoreHidden(); }}
            variant="secondary"
            colors={colors}
            compact
          />
        </View>
      ) : null}

      {!isLoading && recentDocuments.length === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Todavia no hay documentos</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Empieza con un PDF de texto. Si el archivo es un escaneo sin texto embebido, la app lo va a informar.
          </Text>
        </View>
      ) : null}

      {librarySections.sections.map((section) => {
        const isExpanded = expandedFolders[section.folderUri] ?? true;
        return (
          <View key={section.folderUri} style={styles.folderGroup}>
            <Pressable
              onPress={() =>
                setExpandedFolders((prev) => ({ ...prev, [section.folderUri]: !isExpanded }))
              }
              style={[styles.folderHeader, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
            >
              <Text style={[styles.folderChevron, { color: colors.primary }]}>{isExpanded ? '▾' : '▸'}</Text>
              <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>
                📁 {section.name}
              </Text>
              <Text style={[styles.folderCount, { color: colors.textMuted }]}>
                {section.books.length} libro{section.books.length === 1 ? '' : 's'}
              </Text>
            </Pressable>
            {isExpanded ? (
              <View style={styles.grid}>
                {section.books.map((document) => (
                  <BookGridItem
                    key={document.id}
                    book={document}
                    colors={colors}
                    progress={progressMap.get(document.id)}
                    onOpen={() => openReader(document.id)}
                    onLongPress={() => openChooser(document)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      {librarySections.ungrouped.length > 0 && librarySections.sections.length > 0 ? (
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: 16 }]}>Otros libros</Text>
      ) : null}

      <View style={styles.grid}>
        {librarySections.ungrouped.map((document) => (
          <BookGridItem
            key={document.id}
            book={document}
            colors={colors}
            progress={progressMap.get(document.id)}
            onOpen={() => openReader(document.id)}
            onLongPress={() => openChooser(document)}
          />
        ))}
      </View>

      <OptionPickerModal
        title={pendingBook ? getDisplayTitle(pendingBook) : '¿Cómo querés seguir?'}
        visible={pendingBook !== null}
        options={[
          {
            value: 'read',
            label: '📖 Leer',
            description: pendingProgress > 0 ? `Retoma en el ${pendingProgress.toFixed(0)}%.` : 'Empieza desde la primera página.',
          },
          {
            value: 'listen',
            label: '🎧 Escuchar',
            description: pendingProgress > 0 ? `La voz arranca en el ${pendingProgress.toFixed(0)}%.` : 'La voz arranca desde el principio.',
          },
          ...(pendingProgress > 0
            ? [{
                value: 'restart',
                label: '🔄 Empezar de nuevo',
                description: 'Borra tu progreso y arranca desde cero (pide confirmación).',
              }]
            : []),
          {
            value: 'delete',
            label: '🗑 Eliminar de la biblioteca',
            description: 'Borra el libro, su progreso y el audio generado (pide confirmación).',
          },
        ]}
        selectedValue=""
        colors={colors}
        onClose={() => setPendingBook(null)}
        onSelect={(value) => {
          const book = pendingBook;
          if (!book) return;
          if (value === 'delete') {
            setPendingBook(null);
            confirmDeleteDocument(book);
            return;
          }
          if (value === 'restart') {
            Alert.alert(
              '¿Empezar de nuevo?',
              `Se borra tu progreso de "${book.title ?? book.name}" (${pendingProgress.toFixed(0)}%). Esto no se puede deshacer.`,
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Borrar progreso',
                  style: 'destructive',
                  onPress: () => {
                    setPendingBook(null);
                    void (async () => {
                      await bookProgressRepository.resetProgress(book.id);
                      await loadRecentDocuments();
                    })();
                  },
                },
              ],
            );
            return;
          }
          setPendingBook(null);
          openReader(book.id, false, value as 'read' | 'listen');
        }}
      />
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
  folderGroup: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 16 },
  heroCompact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hiddenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hiddenBannerText: { flex: 1, fontSize: 13 },
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  folderChevron: { fontSize: 14, fontWeight: '800' },
  folderName: { flex: 1, fontSize: 15, fontWeight: '700' },
  folderCount: { fontSize: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptySubtitle: { fontSize: 14, lineHeight: 20 },
});
