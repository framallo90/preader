import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { readerJumpStore } from '../src/services/readerJumpStore';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { bookRepository } from '../src/storage/bookRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { collectionRepository } from '../src/storage/collectionRepository';
import { noteRepository } from '../src/storage/noteRepository';
import { Book, BookNote, BookStatus, Chapter, Collection, NoteType } from '../src/types/storage';
import { getDisplayTitle } from '../src/utils/bookDisplay';

const NOTE_ICONS: Record<NoteType, string> = { bookmark: '🔖', quote: '❝', note: '✎' };
const NOTE_LABELS: Record<NoteType, string> = { bookmark: 'Marcador', quote: 'Cita', note: 'Nota' };
const MAX_CHAPTERS_COLLAPSED = 8;

/**
 * "Sobre este libro": todo lo de un libro en una sola vista — estado, reseña,
 * colecciones, índice y anotaciones — en vez de una pantalla por cada cosa.
 */
export default function BookScreen() {
  const { bookId, from } = useLocalSearchParams<{ bookId?: string; from?: string }>();
  const { colors } = useAppSettings();
  const [book, setBook] = useState<Book | null>(null);
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [notes, setNotes] = useState<BookNote[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [reviewDraft, setReviewDraft] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const load = useCallback(async () => {
    if (!bookId) return;
    const [loadedBook, loadedProgress, loadedChapters, loadedNotes, loadedCollections, membership] = await Promise.all([
      bookRepository.getBookById(bookId),
      bookProgressRepository.getProgress(bookId),
      chapterRepository.listChaptersForBook(bookId),
      noteRepository.listForBook(bookId),
      collectionRepository.listCollections(),
      collectionRepository.listCollectionIdsForBook(bookId),
    ]);
    setBook(loadedBook);
    setProgress(loadedProgress?.percentage ?? 0);
    setChapters(loadedChapters);
    setNotes(loadedNotes);
    setCollections(loadedCollections);
    setMemberOf(new Set(membership));
    setReviewDraft(loadedBook?.review ?? '');
    setIsLoading(false);
  }, [bookId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Abre el lector en una posición. Si esta pantalla se abrió DESDE el lector,
  // alcanza con volver: el lector consume el salto pendiente al recuperar foco.
  const openAt = useCallback(
    (charIndex: number | null, mode?: 'listen') => {
      if (!book) return;
      if (charIndex !== null) readerJumpStore.request(book.id, charIndex);
      if (from === 'reader' && !mode) {
        router.back();
        return;
      }
      router.push({ pathname: '/reader', params: mode ? { documentId: book.id, mode } : { documentId: book.id } });
    },
    [book, from],
  );

  const handleStatus = useCallback(
    async (status: BookStatus) => {
      if (!book) return;
      const next = book.status === status ? 'none' : status;
      setBook({ ...book, status: next });
      await bookRepository.setStatus(book.id, next);
    },
    [book],
  );

  const handleFavorite = useCallback(async () => {
    if (!book) return;
    setBook({ ...book, favorite: !book.favorite });
    await bookRepository.setFavorite(book.id, !book.favorite);
  }, [book]);

  const handleRating = useCallback(
    async (stars: number) => {
      if (!book) return;
      const rating = book.rating === stars ? null : stars;
      setBook({ ...book, rating });
      await bookRepository.setReview(book.id, rating, reviewDraft);
    },
    [book, reviewDraft],
  );

  const handleSaveReview = useCallback(async () => {
    if (!book) return;
    await bookRepository.setReview(book.id, book.rating, reviewDraft);
    setBook({ ...book, review: reviewDraft.trim() || null });
  }, [book, reviewDraft]);

  const handleToggleCollection = useCallback(
    async (collectionId: string) => {
      if (!book) return;
      const included = !memberOf.has(collectionId);
      setMemberOf((prev) => {
        const next = new Set(prev);
        if (included) next.add(collectionId);
        else next.delete(collectionId);
        return next;
      });
      await collectionRepository.setBookInCollection(book.id, collectionId, included);
    },
    [book, memberOf],
  );

  const handleCreateCollection = useCallback(async () => {
    const name = newCollectionName.trim();
    if (!name || !book) return;
    const created = await collectionRepository.createCollection(name);
    await collectionRepository.setBookInCollection(book.id, created.id, true);
    setNewCollectionName('');
    await load();
  }, [newCollectionName, book, load]);

  const handleDeleteCollection = useCallback(
    (collection: Collection) => {
      Alert.alert(`Borrar "${collection.name}"`, 'Se borra la colección; los libros quedan en la biblioteca.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => {
            void collectionRepository.removeCollection(collection.id).then(load);
          },
        },
      ]);
    },
    [load],
  );

  const handleDeleteNote = useCallback(
    (note: BookNote) => {
      Alert.alert(`Borrar ${NOTE_LABELS[note.type].toLowerCase()}`, '¿Seguro? No se puede deshacer.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => {
            void noteRepository.removeNote(note.id).then(load);
          },
        },
      ]);
    },
    [load],
  );

  const handleSaveNoteComment = useCallback(async () => {
    if (!editingNoteId) return;
    await noteRepository.updateComment(editingNoteId, noteDraft.trim() || null);
    setEditingNoteId(null);
    setNoteDraft('');
    await load();
  }, [editingNoteId, noteDraft, load]);

  const visibleChapters = useMemo(
    () => (showAllChapters ? chapters : chapters.slice(0, MAX_CHAPTERS_COLLAPSED)),
    [chapters, showAllChapters],
  );

  if (isLoading) {
    return (
      <Screen colors={colors}>
        <Stack.Screen options={{ title: 'Sobre este libro' }} />
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      </Screen>
    );
  }

  if (!book) {
    return (
      <Screen colors={colors}>
        <Stack.Screen options={{ title: 'Sobre este libro' }} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Este libro ya no está en la biblioteca.</Text>
      </Screen>
    );
  }

  const cardStyle = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen colors={colors} scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Sobre este libro' }} />

      <View style={styles.header}>
        {book.coverUri ? (
          <Image source={{ uri: book.coverUri }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, { backgroundColor: colors.surfaceMuted }]} />
        )}
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={4}>{getDisplayTitle(book)}</Text>
          {book.author ? <Text style={[styles.author, { color: colors.textMuted }]}>{book.author}</Text> : null}
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {progress > 0 ? `${progress.toFixed(0)}% leído` : 'Sin empezar'}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.min(progress, 100)}%` }]} />
          </View>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <AppButton label="📖 Leer" onPress={() => openAt(null)} colors={colors} fullWidth />
        </View>
        <View style={styles.flex}>
          <AppButton label="🎧 Escuchar" onPress={() => openAt(null, 'listen')} variant="secondary" colors={colors} fullWidth />
        </View>
      </View>

      <View style={cardStyle}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Mi lista</Text>
        <View style={styles.chips}>
          <Chip label="Para leer" active={book.status === 'to_read'} onPress={() => { void handleStatus('to_read'); }} colors={colors} />
          <Chip label="Leído" active={book.status === 'read'} onPress={() => { void handleStatus('read'); }} colors={colors} />
          <Chip label={book.favorite ? '♥ Favorito' : '♡ Favorito'} active={book.favorite} onPress={() => { void handleFavorite(); }} colors={colors} />
        </View>
      </View>

      <View style={cardStyle}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Mi reseña</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable key={star} onPress={() => { void handleRating(star); }} hitSlop={6}>
              <Text style={[styles.star, { color: (book.rating ?? 0) >= star ? colors.primary : colors.border }]}>★</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={reviewDraft}
          onChangeText={setReviewDraft}
          onBlur={() => { void handleSaveReview(); }}
          placeholder="¿Qué te pareció?"
          placeholderTextColor={colors.textMuted}
          multiline
          style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
        />
      </View>

      <View style={cardStyle}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Colecciones</Text>
        {collections.length > 0 ? (
          <View style={styles.chips}>
            {collections.map((collection) => (
              <Chip
                key={collection.id}
                label={collection.name}
                active={memberOf.has(collection.id)}
                onPress={() => { void handleToggleCollection(collection.id); }}
                onLongPress={() => handleDeleteCollection(collection)}
                colors={colors}
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.hint, { color: colors.textMuted }]}>Todavía no hay colecciones. Creá una para agrupar libros.</Text>
        )}
        {collections.length > 0 ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>Tocá para agregar o quitar este libro. Mantené apretado para borrar la colección.</Text>
        ) : null}
        <View style={styles.row}>
          <TextInput
            value={newCollectionName}
            onChangeText={setNewCollectionName}
            placeholder="Nueva colección"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={() => { void handleCreateCollection(); }}
            style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
          />
          <AppButton label="Crear" onPress={() => { void handleCreateCollection(); }} variant="secondary" colors={colors} compact disabled={!newCollectionName.trim()} />
        </View>
      </View>

      {chapters.length > 0 ? (
        <View style={cardStyle}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Índice · {chapters.length} capítulos</Text>
          {visibleChapters.map((chapter) => (
            <Pressable key={chapter.id} onPress={() => openAt(chapter.startChar)} style={[styles.listRow, { borderColor: colors.border }]}>
              <Text style={[styles.listRowText, { color: colors.text }]} numberOfLines={1}>{chapter.title}</Text>
              <Text style={[styles.listRowMeta, { color: colors.textMuted }]}>›</Text>
            </Pressable>
          ))}
          {chapters.length > MAX_CHAPTERS_COLLAPSED ? (
            <AppButton
              label={showAllChapters ? 'Ver menos' : `Ver los ${chapters.length}`}
              onPress={() => setShowAllChapters((value) => !value)}
              variant="ghost"
              colors={colors}
              compact
            />
          ) : null}
        </View>
      ) : null}

      <View style={cardStyle}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Marcadores, citas y notas · {notes.length}</Text>
        {notes.length === 0 ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            En el lector: 🔖 marca la posición actual; mantené apretado un párrafo o una página para guardar una cita o una nota.
          </Text>
        ) : null}
        {notes.map((note) => (
          <View key={note.id} style={[styles.noteRow, { borderColor: colors.border }]}>
            <Pressable onPress={() => openAt(note.charIndex)} onLongPress={() => handleDeleteNote(note)} style={styles.flex}>
              <Text style={[styles.noteHeader, { color: colors.primary }]}>
                {NOTE_ICONS[note.type]} {NOTE_LABELS[note.type]}{note.page !== null ? ` · pág. ${note.page + 1}` : ''}
              </Text>
              {note.body ? <Text style={[styles.noteBody, { color: colors.text }]} numberOfLines={5}>{note.body}</Text> : null}
              {note.comment ? <Text style={[styles.noteComment, { color: colors.textMuted }]}>{note.comment}</Text> : null}
            </Pressable>
            {editingNoteId === note.id ? (
              <View style={styles.noteEditor}>
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Tu nota"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  autoFocus
                  style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}
                />
                <View style={styles.row}>
                  <AppButton label="Guardar" onPress={() => { void handleSaveNoteComment(); }} colors={colors} compact />
                  <AppButton label="Cancelar" onPress={() => setEditingNoteId(null)} variant="ghost" colors={colors} compact />
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <AppButton
                  label={note.comment ? 'Editar nota' : 'Agregar nota'}
                  onPress={() => { setEditingNoteId(note.id); setNoteDraft(note.comment ?? ''); }}
                  variant="ghost"
                  colors={colors}
                  compact
                />
                <AppButton label="Borrar" onPress={() => handleDeleteNote(note)} variant="ghost" colors={colors} compact labelStyle={{ color: colors.danger }} />
              </View>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}

type ChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  colors: ReturnType<typeof useAppSettings>['colors'];
};

function Chip({ label, active, onPress, onLongPress, colors }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.chip,
        { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.accent : 'transparent' },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.text : colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14 },
  loading: { marginTop: 40 },
  emptyText: { fontSize: 15, textAlign: 'center', marginTop: 40 },
  header: { flexDirection: 'row', gap: 14 },
  cover: { width: 104, aspectRatio: 0.7, borderRadius: 10, overflow: 'hidden' },
  headerCopy: { flex: 1, gap: 6, justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 24 },
  author: { fontSize: 14 },
  meta: { fontSize: 12.5 },
  progressTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  stars: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 30 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  listRowText: { flex: 1, fontSize: 14 },
  listRowMeta: { fontSize: 16 },
  noteRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 6 },
  noteHeader: { fontSize: 12, fontWeight: '700' },
  noteBody: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  noteComment: { fontSize: 13, lineHeight: 19, fontStyle: 'italic', marginTop: 3 },
  noteEditor: { gap: 8 },
});
