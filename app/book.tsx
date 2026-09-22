import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { Screen } from '../src/components/Screen';
import { Chip, Icon, IconName, Row, Section } from '../src/components/ui';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { readerJumpStore } from '../src/services/readerJumpStore';
import { isComicFile } from '../src/services/bookTypes';
import { remainingLabel } from '../src/utils/readingTime';
import { bookProgressRepository } from '../src/storage/bookProgressRepository';
import { bookRepository } from '../src/storage/bookRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { collectionRepository } from '../src/storage/collectionRepository';
import { noteRepository } from '../src/storage/noteRepository';
import { parsedDocumentRepository } from '../src/storage/parsedDocumentRepository';
import { Book, BookNote, BookStatus, Chapter, Collection, NoteType } from '../src/types/storage';
import { getDisplayTitle } from '../src/utils/bookDisplay';
import { getDocumentTypeLabel } from '../src/utils/formatters';
import { radius } from '../src/utils/theme';

const NOTE_ICONS: Record<NoteType, IconName> = { bookmark: 'bookmark', quote: 'chatbox-ellipses-outline', note: 'create-outline' };
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
  // Tamaño del libro: con esto y el avance se dice cuánto falta.
  const [readingSize, setReadingSize] = useState<{ textLength: number | null; pageCount: number | null }>({
    textLength: null,
    pageCount: null,
  });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [notes, setNotes] = useState<BookNote[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [reviewDraft, setReviewDraft] = useState('');
  // El resumen se muestra como texto y se vuelve editable al tocarlo.
  const [summaryDraft, setSummaryDraft] = useState('');
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const load = useCallback(async () => {
    // Sin id (link directo, estado restaurado): no dejar el spinner girando para
    // siempre; se muestra el mismo cartel que cuando el libro ya no está.
    if (!bookId) {
      setIsLoading(false);
      return;
    }
    const [loadedBook, loadedProgress, loadedChapters, loadedNotes, loadedCollections, membership, loadedSize] = await Promise.all([
      bookRepository.getBookById(bookId),
      bookProgressRepository.getProgress(bookId),
      chapterRepository.listChaptersForBook(bookId),
      noteRepository.listForBook(bookId),
      collectionRepository.listCollections(),
      collectionRepository.listCollectionIdsForBook(bookId),
      // Largo del texto y total de páginas, para estimar cuánto falta. Es una
      // consulta liviana: no trae el texto del libro por el puente.
      parsedDocumentRepository.getReadingSize(bookId),
    ]);
    setBook(loadedBook);
    setProgress(loadedProgress?.percentage ?? 0);
    setReadingSize(loadedSize);
    setChapters(loadedChapters);
    setNotes(loadedNotes);
    setCollections(loadedCollections);
    setMemberOf(new Set(membership));
    setReviewDraft(loadedBook?.review ?? '');
    setSummaryDraft(loadedBook?.summary ?? '');
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
      // Volver al lector que ya está abierto, nunca apilar otro encima: dos
      // lectores del mismo libro escriben progreso en paralelo y el de arriba,
      // al cerrarse, cierra el PDF que el de abajo sigue usando.
      if (from === 'reader') {
        if (charIndex !== null || mode === 'listen') {
          readerJumpStore.request(book.id, charIndex, mode === 'listen');
        }
        router.back();
        return;
      }
      if (charIndex !== null) readerJumpStore.request(book.id, charIndex);
      router.push({ pathname: '/reader', params: mode ? { documentId: book.id, mode } : { documentId: book.id } });
    },
    [book, from],
  );

  const handleSaveSummary = useCallback(async () => {
    if (!book) return;
    const limpio = summaryDraft.trim();
    setIsEditingSummary(false);
    if (limpio === (book.summary ?? '')) return;
    // Vacío = borrarlo (por eso setSummary y no updateBookMetadata, que con null
    // entiende "no lo toques").
    setBook({ ...book, summary: limpio || null });
    await bookRepository.setSummary(book.id, limpio || null);
  }, [book, summaryDraft]);

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

  // Cuánto falta. Un cómic se mide en páginas; el resto, en caracteres.
  const remaining = book
    ? remainingLabel({
        textLength: readingSize.textLength,
        pageCount: readingSize.pageCount,
        percentage: progress,
        isComic: isComicFile(book.type, book.name),
      })
    : null;

  if (isLoading) {
    return (
      <Screen colors={colors} underHeader>
        <Stack.Screen options={{ title: 'Sobre este libro' }} />
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      </Screen>
    );
  }

  if (!book) {
    return (
      <Screen colors={colors} underHeader>
        <Stack.Screen options={{ title: 'Sobre este libro' }} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Este libro ya no está en la biblioteca.</Text>
      </Screen>
    );
  }

  const inputStyle = [styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceMuted }];

  return (
    <Screen colors={colors} scroll underHeader contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Sobre este libro' }} />

      <View style={[styles.header, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {book.coverUri ? (
          <Image source={{ uri: book.coverUri }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={[styles.cover, { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }]}>
            <Icon name="book-outline" size={30} color={colors.primary} />
          </View>
        )}
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={4}>{getDisplayTitle(book)}</Text>
          {book.author ? <Text style={[styles.author, { color: colors.textMuted }]}>{book.author}</Text> : null}
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {getDocumentTypeLabel(book.type)} · {progress > 0 ? `${progress.toFixed(0)} % leído` : 'Sin empezar'}
            {remaining ? ` · te faltan ${remaining}` : ''}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.warm, width: `${Math.min(Math.max(progress, 2), 100)}%` }]} />
          </View>
          <View style={styles.row}>
            <AppButton label="Leer" icon="book-outline" onPress={() => openAt(null)} colors={colors} compact style={styles.flex} />
            {/* Un cómic son imágenes: no hay nada que narrar. */}
            {isComicFile(book.type, book.name) ? null : (
              <AppButton label="Escuchar" icon="headset-outline" onPress={() => openAt(null, 'listen')} variant="secondary" colors={colors} compact style={styles.flex} />
            )}
          </View>
        </View>
      </View>

      <Section title="Mi lista" colors={colors}>
        <View style={styles.chips}>
          <Chip label="Para leer" icon="bookmark-outline" active={book.status === 'to_read'} onPress={() => { void handleStatus('to_read'); }} colors={colors} />
          <Chip label="Leído" icon="checkmark-done-outline" active={book.status === 'read'} onPress={() => { void handleStatus('read'); }} colors={colors} />
          <Chip label="Favorito" icon={book.favorite ? 'heart' : 'heart-outline'} active={book.favorite} onPress={() => { void handleFavorite(); }} colors={colors} />
        </View>
      </Section>

      <Section
        title="De qué va"
        colors={colors}
        hint={book.summary && !isEditingSummary ? 'Tocá el texto para cambiarlo.' : undefined}
      >
        <View style={styles.padded}>
          {isEditingSummary || !book.summary ? (
            <TextInput
              value={summaryDraft}
              onChangeText={setSummaryDraft}
              onBlur={() => { void handleSaveSummary(); }}
              placeholder="Todavía no hay resumen. Escribí de qué va este libro."
              placeholderTextColor={colors.textMuted}
              multiline
              style={[inputStyle, styles.inputMultiline]}
              autoFocus={isEditingSummary}
            />
          ) : (
            <Pressable onPress={() => setIsEditingSummary(true)} accessibilityRole="button">
              <Text style={[styles.summary, { color: colors.text }]}>{book.summary}</Text>
            </Pressable>
          )}
        </View>
      </Section>

      <Section title="Mi reseña" colors={colors}>
        <View style={styles.padded}>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable key={star} onPress={() => { void handleRating(star); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${star} estrellas`}>
                <Icon name={(book.rating ?? 0) >= star ? 'star' : 'star-outline'} size={30} color={(book.rating ?? 0) >= star ? colors.warm : colors.border} />
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
            style={[inputStyle, styles.inputMultiline]}
          />
        </View>
      </Section>

      <Section
        title="Colecciones"
        colors={colors}
        hint={collections.length > 0 ? 'Tocá para agregar o quitar este libro. Mantené apretada una colección para borrarla.' : undefined}
      >
        <View style={styles.padded}>
          {collections.length > 0 ? (
            <View style={styles.chips}>
              {collections.map((collection) => (
                <Chip
                  key={collection.id}
                  label={collection.name}
                  icon="albums-outline"
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
          <View style={styles.row}>
            <TextInput
              value={newCollectionName}
              onChangeText={setNewCollectionName}
              placeholder="Nueva colección"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => { void handleCreateCollection(); }}
              style={[inputStyle, styles.flex]}
            />
            <AppButton label="Crear" icon="add" onPress={() => { void handleCreateCollection(); }} variant="secondary" colors={colors} compact disabled={!newCollectionName.trim()} />
          </View>
        </View>
      </Section>

      {chapters.length > 0 ? (
        <Section title={`Índice · ${chapters.length} capítulos`} colors={colors}>
          {visibleChapters.map((chapter, index) => (
            <Row
              key={chapter.id}
              title={chapter.title}
              colors={colors}
              onPress={() => openAt(chapter.startChar)}
              last={index === visibleChapters.length - 1 && chapters.length <= MAX_CHAPTERS_COLLAPSED}
            />
          ))}
          {chapters.length > MAX_CHAPTERS_COLLAPSED ? (
            <Row
              icon={showAllChapters ? 'chevron-up' : 'chevron-down'}
              title={showAllChapters ? 'Ver menos' : `Ver los ${chapters.length} capítulos`}
              colors={colors}
              onPress={() => setShowAllChapters((value) => !value)}
              last
            />
          ) : null}
        </Section>
      ) : null}

      <Section
        title={`Marcadores, citas y notas · ${notes.length}`}
        colors={colors}
        hint={notes.length === 0 ? 'En el lector: el marcador guarda la posición actual; mantené apretado un párrafo o una página para guardar una cita o una nota.' : undefined}
      >
        {notes.length === 0 ? (
          <View style={styles.padded}>
            <Text style={[styles.hint, { color: colors.textMuted }]}>Todavía no hay anotaciones.</Text>
          </View>
        ) : null}
        {notes.map((note, index) => (
          <View key={note.id} style={[styles.noteRow, index < notes.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border } : null]}>
            <Pressable onPress={() => openAt(note.charIndex)} onLongPress={() => handleDeleteNote(note)} style={styles.flex}>
              <View style={styles.noteHeaderRow}>
                <Icon name={NOTE_ICONS[note.type]} size={15} color={colors.primary} />
                <Text style={[styles.noteHeader, { color: colors.primary }]}>
                  {NOTE_LABELS[note.type]}{note.page !== null ? ` · pág. ${note.page + 1}` : ''}
                </Text>
              </View>
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
                  style={[inputStyle, styles.inputMultiline]}
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
                  icon="create-outline"
                  onPress={() => { setEditingNoteId(note.id); setNoteDraft(note.comment ?? ''); }}
                  variant="ghost"
                  colors={colors}
                  compact
                />
                <AppButton label="Borrar" icon="trash-outline" onPress={() => handleDeleteNote(note)} variant="ghost" colors={colors} compact labelStyle={{ color: colors.danger }} />
              </View>
            )}
          </View>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  loading: { marginTop: 40 },
  emptyText: { fontSize: 15, textAlign: 'center', marginTop: 40 },
  header: { flexDirection: 'row', gap: 14, borderWidth: 1, borderRadius: radius.xl, padding: 14 },
  cover: { width: 104, aspectRatio: 0.7, borderRadius: 10, overflow: 'hidden' },
  headerCopy: { flex: 1, gap: 6, justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 24 },
  author: { fontSize: 14 },
  meta: { fontSize: 12.5 },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  summary: { fontSize: 15, lineHeight: 22 },
  padded: { padding: 14, gap: 10 },
  hint: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14 },
  stars: { flexDirection: 'row', gap: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  noteRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  noteHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteHeader: { fontSize: 12, fontWeight: '700' },
  noteBody: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  noteComment: { fontSize: 13, lineHeight: 19, fontStyle: 'italic', marginTop: 3 },
  noteEditor: { gap: 8 },
});
