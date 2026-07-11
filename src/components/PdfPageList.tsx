import { Image } from 'expo-image';
import { ForwardedRef, forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { FlatList, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { getPageImageSource } from '../services/bardoServerService';
import { ThemeColors } from '../utils/theme';

type PdfPageListProps = {
  bookId: string;
  pageCount: number;
  /** ancho/alto de página; si falta se asume A4 (~0.707). */
  pageAspect: number | null;
  initialPage: number;
  colors: ThemeColors;
  onPageChange?: (pageIndex: number) => void;
  /** Toque simple sobre la página (p. ej. alternar pantalla completa). */
  onTap?: () => void;
  /** Página que la voz está leyendo ahora (su número se marca con 🔊). */
  speakingPage?: number | null;
};

export type PdfPageListHandle = {
  /** Salta directo a una página (para el scrubber). */
  scrollToPage: (pageIndex: number) => void;
};

const DEFAULT_ASPECT = 0.707;
const PAGE_GAP = 8;

/**
 * Lector visual estilo ReadEra: las páginas del PDF (renderizadas por el server
 * al ancho del teléfono) en un scroll vertical continuo. El ancho se ajusta a la
 * pantalla y, al rotar, useWindowDimensions re-renderiza y las páginas se piden
 * al ancho nuevo (expo-image cachea en disco: lo ya visto queda offline).
 */
const PdfPageListInner = forwardRef(function PdfPageList(
  {
    bookId,
    pageCount,
    pageAspect,
    initialPage,
    colors,
    onPageChange,
    onTap,
    speakingPage,
  }: PdfPageListProps,
  ref: ForwardedRef<PdfPageListHandle>,
) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<number>>(null);
  const currentPageRef = useRef(Math.min(Math.max(initialPage, 0), pageCount - 1));
  // Ref para no capturar un callback viejo en el onScroll.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const aspect = pageAspect && pageAspect > 0.2 && pageAspect < 5 ? pageAspect : DEFAULT_ASPECT;
  const pageHeight = Math.round(width / aspect);
  const requestWidth = Math.min(2048, Math.round(width * PixelRatio.get()));

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i), [pageCount]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (pageIndex: number) => {
      const target = Math.min(Math.max(pageIndex, 0), pageCount - 1);
      currentPageRef.current = target;
      listRef.current?.scrollToIndex({ index: target, animated: false });
      onPageChange?.(target);
    },
  }), [pageCount, onPageChange]);

  // Página actual calculada directo del offset de scroll (alturas uniformes):
  // más confiable que onViewableItemsChanged, que a veces no dispara.
  const itemLength = pageHeight + PAGE_GAP;
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const page = Math.min(
        pageCount - 1,
        Math.max(0, Math.round(event.nativeEvent.contentOffset.y / itemLength)),
      );
      if (page !== currentPageRef.current) {
        currentPageRef.current = page;
        onPageChangeRef.current?.(page);
      }
    },
    [itemLength, pageCount],
  );

  return (
    <FlatList
      ref={listRef}
      // Al rotar cambia el width → remonta la lista y retoma en la página actual.
      key={`pdf-${width}`}
      data={pages}
      keyExtractor={(page) => `p-${page}`}
      initialScrollIndex={currentPageRef.current}
      getItemLayout={(_, index) => ({
        length: pageHeight + PAGE_GAP,
        offset: (pageHeight + PAGE_GAP) * index,
        index,
      })}
      onScroll={handleScroll}
      scrollEventThrottle={80}
      windowSize={5}
      maxToRenderPerBatch={3}
      showsVerticalScrollIndicator
      renderItem={({ item: pageIndex }) => (
        <Pressable onPress={onTap} style={[styles.pageWrap, { height: pageHeight + PAGE_GAP }]}>
          <Image
            source={getPageImageSource(bookId, pageIndex, requestWidth)}
            style={{ width, height: pageHeight, backgroundColor: '#ffffff' }}
            contentFit="contain"
            cachePolicy="disk"
            transition={80}
            placeholder={null}
          />
          <Text style={[styles.pageNumber, speakingPage === pageIndex ? styles.pageNumberSpeaking : null]}>
            {speakingPage === pageIndex ? `🔊 ${pageIndex + 1}` : pageIndex + 1}
          </Text>
        </Pressable>
      )}
    />
  );
});

/**
 * Memoizado: durante la reproducción, la posición del audio actualiza estados
 * del lector ~4 veces por segundo; sin memo, cada tick re-renderizaba la lista
 * entera de páginas y congelaba la UI. El marker se compara por valor y está
 * cuantizado (pasos del 2%) para redibujar solo cuando la voz avanza de verdad.
 */
export const PdfPageList = memo(PdfPageListInner, (prev, next) =>
  prev.bookId === next.bookId &&
  prev.pageCount === next.pageCount &&
  prev.pageAspect === next.pageAspect &&
  prev.initialPage === next.initialPage &&
  prev.colors === next.colors &&
  prev.onPageChange === next.onPageChange &&
  prev.onTap === next.onTap &&
  (prev.speakingPage ?? null) === (next.speakingPage ?? null),
);

const styles = StyleSheet.create({
  pageWrap: {
    alignItems: 'center',
  },
  // El número de la página que la voz lee se destaca (🔊 + color).
  pageNumberSpeaking: {
    backgroundColor: 'rgba(95,140,132,0.95)',
  },
  // Autocontenido (oscuro + blanco): legible sobre la página blanca del PDF
  // en cualquier tema.
  pageNumber: {
    position: 'absolute',
    bottom: 10,
    right: 12,
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: 'rgba(20,20,20,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
