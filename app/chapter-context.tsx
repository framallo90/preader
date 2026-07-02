import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { chapterContextRepository } from '../src/storage/chapterContextRepository';
import { chapterRepository } from '../src/storage/chapterRepository';
import { Chapter, ChapterContext } from '../src/types/storage';

export default function ChapterContextScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId?: string }>();
  const { colors } = useAppSettings();

  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [context, setContext] = useState<ChapterContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chapterId) {
      setError('No se recibio un ID de capítulo.');
      setIsLoading(false);
      return;
    }

    void (async () => {
      try {
        const [ch, ctx] = await Promise.all([
          chapterRepository.getChapterById(chapterId),
          chapterContextRepository.getContextForChapter(chapterId),
        ]);
        setChapter(ch);
        setContext(ctx);
      } catch {
        setError('No se pudo cargar el contexto del capitulo.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [chapterId]);

  const title = chapter?.title ?? 'Contexto del capitulo';

  if (isLoading) {
    return (
      <Screen colors={colors} contentContainerStyle={styles.centered}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.text }]}>Cargando contexto...</Text>
      </Screen>
    );
  }

  if (error || !context) {
    return (
      <Screen colors={colors} contentContainerStyle={styles.centered}>
        <Stack.Screen options={{ title }} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sin contexto disponible</Text>
        <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
          {error ??
            'El contexto de este capitulo todavia no fue extraido. Avanza al siguiente capitulo para que se genere automaticamente.'}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen colors={colors} scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title }} />

      {/* Encabezado del capítulo */}
      <View style={styles.headerBlock}>
        <Text style={[styles.chapterTitle, { color: colors.text }]}>{title}</Text>
        {chapter?.povCharacter ? (
          <View style={[styles.povBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.povBadgeText, { color: colors.background }]}>
              POV — {chapter.povCharacter}
            </Text>
          </View>
        ) : null}
        {context.extractedAt ? (
          <Text style={[styles.extractedAt, { color: colors.textMuted }]}>
            Extraido el {new Date(context.extractedAt).toLocaleDateString('es-AR')}
          </Text>
        ) : null}
      </View>

      {/* Resumen de lo que pasó */}
      {context.afterSummary ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>
            Lo que paso en este capitulo
          </Text>
          <Text style={[styles.cardBody, { color: colors.text }]}>{context.afterSummary}</Text>
        </View>
      ) : null}

      {/* Lo que recordar antes de continuar */}
      {context.beforeSummary ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>
            Para recordar antes del proximo capitulo
          </Text>
          <Text style={[styles.cardBody, { color: colors.text }]}>{context.beforeSummary}</Text>
        </View>
      ) : null}

      {/* Personajes que aparecen */}
      {context.characters.length > 0 ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>
            Personajes en este capitulo
          </Text>
          <View style={styles.tagRow}>
            {context.characters.map((name) => (
              <View
                key={name}
                style={[styles.tag, { backgroundColor: colors.accent, borderColor: colors.border }]}
              >
                <Text style={[styles.tagText, { color: colors.text }]}>{name}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Eventos clave */}
      {context.keyEvents.length > 0 ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardLabel, { color: colors.textMuted }]}>Eventos clave</Text>
          {context.keyEvents.map((event, index) => (
            <View key={index} style={styles.eventRow}>
              <View style={[styles.eventBullet, { backgroundColor: colors.primary }]} />
              <Text style={[styles.eventText, { color: colors.text }]}>{event}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  content: {
    gap: 16,
  },
  headerBlock: {
    gap: 8,
  },
  chapterTitle: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
  },
  povBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  povBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  extractedAt: {
    fontSize: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 23,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eventBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    flexShrink: 0,
  },
  eventText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
});
