import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { AppButton } from './AppButton';
import { Chip, Sheet } from './ui';
import { prepareQuote, quoteFontSize } from '../utils/quoteCard';
import { ThemeColors, radius } from '../utils/theme';

/**
 * Compartir una cita como imagen: una tarjeta con la frase, el libro y el
 * autor, lista para mandar por WhatsApp o subir a una historia.
 *
 * La tarjeta se dibuja acá mismo (es la vista previa) y se "fotografía" tal
 * cual se ve, así que lo que ves es exactamente lo que se manda. Todo pasa en
 * el teléfono: la imagen se arma local y la comparte Android.
 */

type CardStyle = 'paper' | 'night';

/** Los dos papeles de la tarjeta: el sepia del lector y la noche cálida. */
const CARD_STYLES: Record<CardStyle, { background: string; text: string; muted: string; mark: string; rule: string }> = {
  paper: { background: '#F4ECD8', text: '#3B2E1E', muted: '#6E5E49', mark: '#A8412A', rule: '#DDD0B3' },
  night: { background: '#1B1511', text: '#E6CBA6', muted: '#B09A7E', mark: '#E3A56B', rule: '#3D3128' },
};

/** Ancho de la tarjeta en pantalla; la imagen sale a 1080 px de ancho. */
const CARD_WIDTH = 300;
const IMAGE_WIDTH = 1080;

export type ShareableQuote = { body: string; bookTitle: string; author: string | null };

type Props = {
  quote: ShareableQuote | null;
  onClose: () => void;
  colors: ThemeColors;
};

export function QuoteShareSheet({ quote, onClose, colors }: Props) {
  const cardRef = useRef<View>(null);
  const [style, setStyle] = useState<CardStyle>('paper');
  const [isSharing, setIsSharing] = useState(false);
  // Alto real de la tarjeta (depende del largo de la cita), para sacar la
  // imagen a 1080 px de ancho con la misma proporción.
  const cardHeightRef = useRef(0);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    setIsSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('No se puede compartir', 'Este teléfono no tiene con qué compartir imágenes.');
        return;
      }
      // Hay que pasar ancho Y alto: con uno solo sale a la densidad de la
      // pantalla (unos 800 px), que en una historia se ve borroso.
      const alto = cardHeightRef.current > 0 ? Math.round((IMAGE_WIDTH * cardHeightRef.current) / CARD_WIDTH) : undefined;
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        ...(alto ? { width: IMAGE_WIDTH, height: alto } : {}),
      });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Compartir cita' });
    } catch (error) {
      Alert.alert('No se pudo compartir', error instanceof Error ? error.message : 'Probá de nuevo.');
    } finally {
      setIsSharing(false);
    }
  }, []);

  const paleta = CARD_STYLES[style];
  const texto = quote ? prepareQuote(quote.body) : '';
  const tamanio = quoteFontSize(texto);

  return (
    <Sheet visible={quote !== null} onClose={onClose} colors={colors} title="Compartir cita" maxHeight="90%">
      {quote ? (
        <>
          <View style={styles.previewWrap}>
            {/* collapsable={false}: sin esto Android puede "aplanar" la vista y
                la captura sale vacía. */}
            {/* El marco redondea sólo la vista previa: la imagen sale con
                esquinas rectas, porque las transparentes se ven negras o
                blancas según la app que la muestre. */}
            <View style={styles.frame}>
            <View
              ref={cardRef}
              collapsable={false}
              onLayout={(event) => { cardHeightRef.current = event.nativeEvent.layout.height; }}
              style={[styles.card, { backgroundColor: paleta.background }]}
            >
              <Text style={[styles.mark, { color: paleta.mark }]}>“</Text>
              <Text style={[styles.quote, { color: paleta.text, fontSize: tamanio, lineHeight: Math.round(tamanio * 1.4) }]}>
                {texto}
              </Text>
              <View style={[styles.rule, { backgroundColor: paleta.rule }]} />
              <Text style={[styles.book, { color: paleta.text }]} numberOfLines={2}>{quote.bookTitle}</Text>
              {quote.author ? (
                <Text style={[styles.author, { color: paleta.muted }]} numberOfLines={1}>{quote.author}</Text>
              ) : null}
              <Text style={[styles.brand, { color: paleta.mark }]}>Bardo</Text>
            </View>
            </View>
          </View>
          <View style={styles.chips}>
            <Chip label="Papel" icon="sunny-outline" active={style === 'paper'} onPress={() => setStyle('paper')} colors={colors} />
            <Chip label="Noche" icon="moon-outline" active={style === 'night'} onPress={() => setStyle('night')} colors={colors} />
          </View>
          <AppButton
            label={isSharing ? 'Preparando…' : 'Compartir'}
            icon="share-social-outline"
            onPress={() => { void handleShare(); }}
            disabled={isSharing}
            colors={colors}
          />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  previewWrap: { alignItems: 'center' },
  frame: { borderRadius: radius.lg, overflow: 'hidden' },
  card: {
    width: CARD_WIDTH,
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 20,
  },
  mark: { fontSize: 64, lineHeight: 64, fontFamily: 'Lora-Bold', marginBottom: -14 },
  quote: { fontFamily: 'serif' },
  rule: { height: 1.5, width: 40, marginTop: 22, marginBottom: 12 },
  book: { fontSize: 14.5, fontWeight: '700' },
  author: { fontSize: 13, marginTop: 2 },
  brand: { fontSize: 13, fontFamily: 'Lora-Bold', marginTop: 18, alignSelf: 'flex-end' },
  chips: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
});
