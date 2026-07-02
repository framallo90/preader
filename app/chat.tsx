/**
 * app/chat.tsx — Chat companion con contexto de la saga
 *
 * Recibe bookId como param. Carga los capítulos leídos (los que tienen contexto extraído),
 * construye un system prompt con sus resúmenes, y abre un chat multi-turn con Claude Sonnet.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { ChatMessage, chatWithSagaContext } from '../src/services/claudeService';
import { bookRepository } from '../src/storage/bookRepository';
import { chapterContextRepository } from '../src/storage/chapterContextRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { Book, Chapter, ChapterContext } from '../src/types/storage';

type UIMessage = ChatMessage & { id: string };

function buildSagaContext(
  chapters: Chapter[],
  contexts: Map<string, ChapterContext>,
): string {
  const readChapters = chapters
    .filter((ch) => contexts.has(ch.id))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  if (readChapters.length === 0) {
    return 'El lector aún no terminó ningún capítulo.';
  }

  const lines: string[] = [`Capítulos leídos (${readChapters.length} en total):\n`];

  for (const ch of readChapters) {
    const ctx = contexts.get(ch.id)!;
    lines.push(`## ${ch.title}`);
    if (ctx.afterSummary) lines.push(ctx.afterSummary);
    if (ctx.characters.length > 0) {
      lines.push(`Personajes: ${ctx.characters.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default function ChatScreen() {
  const { bookId } = useLocalSearchParams<{ bookId?: string }>();
  const { colors } = useAppSettings();

  const [book, setBook] = useState<Book | null>(null);
  const [sagaContext, setSagaContext] = useState<string>('');
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList<UIMessage>>(null);

  // Carga contexto de la saga al montar
  useEffect(() => {
    if (!bookId) {
      setIsLoadingContext(false);
      return;
    }

    void (async () => {
      try {
        const [loadedBook, chapters] = await Promise.all([
          bookRepository.getBookById(bookId),
          chapterRepository.listChaptersForBook(bookId),
        ]);

        if (!loadedBook) {
          setIsLoadingContext(false);
          return;
        }

        // Carga contextos de todos los capítulos (solo existen si ya fueron extraídos)
        const contextEntries = await Promise.all(
          chapters.map(async (ch) => {
            const ctx = await chapterContextRepository.getContextForChapter(ch.id);
            return [ch.id, ctx] as [string, ChapterContext | null];
          }),
        );

        const contexts = new Map<string, ChapterContext>(
          contextEntries
            .filter((e): e is [string, ChapterContext] => e[1] !== null)
            .map(([id, ctx]) => [id, ctx]),
        );

        setBook(loadedBook);
        setSagaContext(buildSagaContext(chapters, contexts));

        // Mensaje de bienvenida
        const readCount = contexts.size;
        const welcomeText =
          readCount === 0
            ? `Hola. Soy tu asistente de lectura para "${loadedBook.name}". Todavía no terminaste ningún capítulo, así que no tengo contexto para darte. Avanzá un capítulo y volvé.`
            : `Hola. Conozco los ${readCount} capítulo${readCount === 1 ? '' : 's'} que leíste de "${loadedBook.name}". ¿Sobre qué querés hablar?`;

        setMessages([{ id: 'welcome', role: 'assistant', content: welcomeText }]);
      } finally {
        setIsLoadingContext(false);
      }
    })();
  }, [bookId]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    const userMsg: UIMessage = { id: `u-${Date.now()}`, role: 'user', content: text };

    setInputText('');
    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);
    scrollToEnd();

    try {
      // Historial sin el mensaje de bienvenida (no es parte del multi-turn real)
      const history: ChatMessage[] = [...messages, userMsg]
        .filter((m) => m.id !== 'welcome')
        .map(({ role, content }) => ({ role, content }));

      const reply = await chatWithSagaContext(history, sagaContext, book?.name ?? '');

      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: reply },
      ]);
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : 'No se pudo conectar con Claude.';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${errorText}`,
        },
      ]);
    } finally {
      setIsSending(false);
      scrollToEnd();
    }
  }, [inputText, isSending, messages, sagaContext, book, scrollToEnd]);

  const renderMessage = useCallback(
    ({ item }: { item: UIMessage }) => {
      const isUser = item.role === 'user';
      return (
        <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}>
          <View
            style={[
              styles.msgBubble,
              isUser
                ? [styles.msgBubbleUser, { backgroundColor: colors.primary }]
                : [styles.msgBubbleAssistant, { backgroundColor: colors.surface, borderColor: colors.border }],
            ]}
          >
            <Text
              style={[
                styles.msgText,
                { color: isUser ? colors.background : colors.text },
              ]}
            >
              {item.content}
            </Text>
          </View>
        </View>
      );
    },
    [colors],
  );

  const screenTitle = book ? `Chat — ${book.name}` : 'Chat companion';

  if (isLoadingContext) {
    return (
      <Screen colors={colors} contentContainerStyle={styles.centered}>
        <Stack.Screen options={{ title: 'Chat companion' }} />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.text }]}>
          Cargando contexto de la saga...
        </Text>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <Stack.Screen options={{ title: screenTitle }} />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={scrollToEnd}
        renderItem={renderMessage}
      />

      {isSending ? (
        <View style={[styles.typingRow, { borderTopColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={[styles.typingText, { color: colors.textMuted }]}>Claude está escribiendo...</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.readerSurface,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder="Preguntá sobre la saga..."
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={800}
          onSubmitEditing={() => void handleSend()}
          editable={!isSending}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                inputText.trim() && !isSending ? colors.primary : colors.surfaceMuted,
            },
          ]}
          onPress={() => void handleSend()}
          disabled={!inputText.trim() || isSending}
        >
          <Text
            style={[
              styles.sendButtonText,
              { color: inputText.trim() && !isSending ? colors.background : colors.textMuted },
            ]}
          >
            Enviar
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 8,
  },
  listContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  msgRow: {
    marginBottom: 8,
  },
  msgRowUser: {
    alignItems: 'flex-end',
  },
  msgRowAssistant: {
    alignItems: 'flex-start',
  },
  msgBubble: {
    maxWidth: '85%',
    borderRadius: 18,
    padding: 12,
  },
  msgBubbleUser: {
    borderBottomRightRadius: 4,
  },
  msgBubbleAssistant: {
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 22,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  typingText: {
    fontSize: 13,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 21,
  },
  sendButton: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
