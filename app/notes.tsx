import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { Screen } from '../src/components/Screen';
import { QuoteShareSheet, ShareableQuote } from '../src/components/QuoteShareSheet';
import { Icon, IconButton, IconName } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { safeFileName, saveTextFile } from '../src/services/exportService';
import { readerJumpStore } from '../src/services/readerJumpStore';
import { withDatabaseRetry } from '../src/storage/database';
import { NoteWithBook, noteRepository } from '../src/storage/noteRepository';
import { NoteType } from '../src/types/storage';
import { cleanFileName } from '../src/utils/bookDisplay';
import { countLabel } from '../src/utils/formatters';
import { libraryNotesToMarkdown } from '../src/utils/notesMarkdown';
import { radius } from '../src/utils/theme';

const NOTE_ICONS: Record<NoteType, IconName> = {
  bookmark: 'bookmark',
  quote: 'chatbox-ellipses-outline',
  note: 'create-outline',
};
const NOTE_LABELS: Record<NoteType, string> = { bookmark: 'Marcador', quote: 'Cita', note: 'Nota' };

/**
 * "Mis notas": todo lo guardado en todos los libros, junto y buscable.
 *
 * Existe porque muchas veces te acordás de la cita pero no de en qué libro
 * estaba, y hasta ahora había que entrar libro por libro a buscarla.
 */
export default function NotesScreen() {
  const { colors } = useAppSettings();
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteWithBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [sharing, setSharing] = useState<ShareableQuote | null>(null);

  // Cada tecla dispara una búsqueda; gana la ÚLTIMA pedida, no la última en
  // llegar (la de "A" trae más filas y podía llegar después que la de "Ar").
  const requestRef = useRef(0);
  const load = useCallback(async (texto: string) => {
    const requestId = ++requestRef.current;
    try {
      const encontradas = await withDatabaseRetry(() => noteRepository.searchAll(texto));
      if (requestId !== requestRef.current) return;
      setNotes(encontradas);
    } catch {
      if (requestId === requestRef.current) setNotes([]);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(query); }, [load, query]));

  const titleOf = useCallback(
    (note: NoteWithBook) => note.bookTitle?.trim() || cleanFileName(note.bookName),
    [],
  );

  const handleExport = useCallback(async () => {
    if (notes.length === 0) return;
    setIsExporting(true);
    try {
      // Se agrupa por libro para que el archivo se lea como un cuaderno y no
      // como una lista suelta de frases.
      const porLibro = new Map<string, { title: string; notes: NoteWithBook[] }>();
      for (const note of notes) {
        const actual = porLibro.get(note.bookId);
        if (actual) actual.notes.push(note);
        else porLibro.set(note.bookId, { title: titleOf(note), notes: [note] });
      }
      const markdown = libraryNotesToMarkdown([...porLibro.values()]);
      const resultado = await saveTextFile(safeFileName('Mis notas de Bardo', 'md'), 'text/markdown', markdown);
      if (resultado === 'saved') Alert.alert('Listo', `Se guardaron ${countLabel(notes.length, 'anotación', 'anotaciones')}.`);
    } catch (error) {
      Alert.alert('No se pudo exportar', error instanceof Error ? error.message : 'Probá de nuevo.');
    } finally {
      setIsExporting(false);
    }
  }, [notes, titleOf]);

  const openNote = useCallback((note: NoteWithBook) => {
    readerJumpStore.request(note.bookId, note.charIndex);
    // Nunca apilar un lector sobre otro: Mis notas se puede abrir desde el
    // lector (vía Ajustes), y dos lectores escriben progreso en paralelo y el
    // de arriba, al cerrarse, cierra el PDF del de abajo. Se vuelve al Inicio
    // y se abre uno solo.
    router.dismissAll();
    router.push({ pathname: '/reader', params: { documentId: note.bookId } });
  }, []);

  const header = useMemo(() => (
    <View style={styles.header}>
      <View style={[styles.searchField, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
        <Icon name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar en tus citas y notas"
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
            <Icon name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.count, { color: colors.textMuted }]}>
        {isLoading ? 'Buscando…' : countLabel(notes.length, 'anotación', 'anotaciones')}
      </Text>
    </View>
  ), [colors, query, notes.length, isLoading]);

  return (
    <Screen colors={colors} underHeader>
      <Stack.Screen options={{ title: 'Mis notas' }} />
      <FlatList
        data={notes}
        keyExtractor={(note) => note.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              {query.trim()
                ? 'Nada con esas palabras.'
                : 'Todavía no guardaste nada. En el lector, mantené apretado un párrafo o una página.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openNote(item)}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <View style={styles.cardHead}>
              <Icon name={NOTE_ICONS[item.type]} size={14} color={colors.primary} />
              <Text style={[styles.cardKind, { color: colors.primary }]}>
                {NOTE_LABELS[item.type]}
                {item.page !== null ? ` · pág. ${item.page + 1}` : ''}
              </Text>
              {item.body ? (
                <IconButton
                  name="share-social-outline"
                  label="Compartir como imagen"
                  onPress={() => setSharing({ body: item.body ?? '', bookTitle: titleOf(item), author: item.bookAuthor })}
                  colors={colors}
                  size={18}
                  style={styles.shareButton}
                />
              ) : null}
            </View>
            <Text style={[styles.cardBook, { color: colors.textMuted }]} numberOfLines={1}>
              {titleOf(item)}
            </Text>
            {item.body ? (
              <Text style={[styles.cardBody, { color: colors.text }]} numberOfLines={4}>
                {item.body}
              </Text>
            ) : null}
            {item.comment ? (
              <Text style={[styles.cardComment, { color: colors.textMuted }]} numberOfLines={3}>
                {item.comment}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
      {notes.length > 0 ? (
        <View style={[styles.footer, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <AppButton
            label={isExporting ? 'Exportando…' : 'Exportar a Markdown'}
            icon="download-outline"
            onPress={() => { void handleExport(); }}
            disabled={isExporting}
            variant="secondary"
            colors={colors}
          />
        </View>
      ) : null}
      <QuoteShareSheet quote={sharing} onClose={() => setSharing(null)} colors={colors} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8, paddingBottom: 10 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  count: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  spinner: { marginTop: 32 },
  empty: { fontSize: 14, lineHeight: 20, marginTop: 24, textAlign: 'center' },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardKind: { flex: 1, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },
  shareButton: { minWidth: 32, minHeight: 28, marginVertical: -6 },
  cardBook: { fontSize: 12.5, fontWeight: '600' },
  cardBody: { fontSize: 14.5, lineHeight: 20 },
  cardComment: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
