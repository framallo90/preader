import { Image } from 'expo-image';
import { ForwardedRef, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PDF_RENDER_CANCELLED, PdfColorMode, PdfCropBox, requestPdfPage } from '../services/pdfLocalService';
import { ThemeColors } from '../utils/theme';

type PdfPageListProps = {
  bookId: string;
  /** Archivo PDF (file:// o content://) del que se dibujan las páginas. */
  sourceUri: string;
  pageCount: number;
  /** ancho/alto de página sin recortar; si falta se asume A4 (~0.707). */
  pageAspect: number | null;
  /** Recorte de márgenes común a todo el libro, o null para página completa. */
  crop: PdfCropBox | null;
  colorMode: PdfColorMode;
  initialPage: number;
  colors: ThemeColors;
  onPageChange?: (pageIndex: number) => void;
  /** Toque simple sobre la página (p. ej. alternar pantalla completa). */
  onTap?: () => void;
  /** Mantener apretado sobre una página (marcador o nota en esa página). */
  onLongPressPage?: (pageIndex: number) => void;
  /** Página que la voz está leyendo ahora (su número se marca con 🔊). */
  speakingPage?: number | null;
};

export type PdfPageListHandle = {
  /** Salta directo a una página (para el scrubber). */
  scrollToPage: (pageIndex: number) => void;
};

const DEFAULT_ASPECT = 0.707;
const PAGE_GAP = 8;

const PAGE_BACKGROUND: Record<PdfColorMode, string> = {
  day: '#ffffff',
  sepia: '#f4ecd8',
  night: '#121212',
};

type PdfPageImageProps = {
  bookId: string;
  sourceUri: string;
  pageIndex: number;
  widthPx: number;
  width: number;
  height: number;
  colorMode: PdfColorMode;
  crop: PdfCropBox | null;
};

/** Una página: la pide al dibujarse y cancela el pedido si sale de pantalla antes. */
const PdfPageImage = memo(function PdfPageImage({
  bookId,
  sourceUri,
  pageIndex,
  widthPx,
  width,
  height,
  colorMode,
  crop,
}: PdfPageImageProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUri(null);
    setFailed(false);
    const ticket = requestPdfPage({ bookId, uri: sourceUri, pageIndex, widthPx, colorMode, crop });
    ticket.promise
      .then((rendered) => {
        if (alive) setUri(rendered);
      })
      .catch((error: unknown) => {
        const cancelled = error instanceof Error && error.message === PDF_RENDER_CANCELLED;
        if (alive && !cancelled) setFailed(true);
      });
    return () => {
      alive = false;
      ticket.cancel();
    };
  }, [bookId, sourceUri, pageIndex, widthPx, colorMode, crop]);

  const background = PAGE_BACKGROUND[colorMode];

  if (!uri) {
    return (
      <View style={[styles.placeholder, { width, height, backgroundColor: background }]}>
        {failed ? <Text style={styles.placeholderText}>No se pudo dibujar esta página</Text> : null}
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width, height, backgroundColor: background }}
      contentFit="contain"
      // El archivo ya está en disco: un segundo caché de expo-image solo duplica espacio.
      cachePolicy="memory"
      transition={60}
    />
  );
});

/**
 * Lector visual estilo ReadEra: las páginas del PDF dibujadas en el teléfono al
 * ancho de la pantalla, en un scroll vertical continuo. Al rotar,
 * useWindowDimensions re-renderiza y las páginas se piden al ancho nuevo.
 */
const PdfPageListInner = forwardRef(function PdfPageList(
  {
    bookId,
    sourceUri,
    pageCount,
    pageAspect,
    crop,
    colorMode,
    initialPage,
    colors,
    onPageChange,
    onTap,
    onLongPressPage,
    speakingPage,
  }: PdfPageListProps,
  ref: ForwardedRef<PdfPageListHandle>,
) {
  // El ancho de página es el del CONTENEDOR. El lector vive en una tarjeta con
  // márgenes y borde: usando el ancho de la ventana la imagen desbordaba ~22 px y
  // se recortaba del lado derecho. Con márgenes blancos no se notaba; con el
  // recorte de márgenes se comía el final de cada renglón.
  const { width: windowWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const width = containerWidth ?? windowWidth;
  const listRef = useRef<FlatList<number>>(null);
  const currentPageRef = useRef(Math.min(Math.max(initialPage, 0), pageCount - 1));
  // Ref para no capturar un callback viejo en el onScroll.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const baseAspect = pageAspect && pageAspect > 0.2 && pageAspect < 5 ? pageAspect : DEFAULT_ASPECT;
  // Con recorte, la proporción visible es la de la caja de contenido.
  const aspect = crop ? (baseAspect * (crop[2] - crop[0])) / (crop[3] - crop[1]) : baseAspect;
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

  const handleLayout = (event: { nativeEvent: { layout: { width: number } } }) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== containerWidth) setContainerWidth(measured);
  };

  // Hasta medir el contenedor no se pide ninguna página (se dibujarían a un
  // ancho equivocado y habría que tirarlas).
  if (containerWidth === null) {
    return <View style={styles.measure} onLayout={handleLayout} />;
  }

  return (
    <View style={styles.measure} onLayout={handleLayout}>
    <FlatList
      ref={listRef}
      // Al rotar cambia el width → remonta la lista y retoma en la página actual.
      key={`pdf-${width}`}
      style={{ backgroundColor: colors.readerSurface }}
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
        <Pressable
          onPress={onTap}
          onLongPress={onLongPressPage ? () => onLongPressPage(pageIndex) : undefined}
          delayLongPress={350}
          style={[styles.pageWrap, { height: pageHeight + PAGE_GAP }]}
        >
          <PdfPageImage
            bookId={bookId}
            sourceUri={sourceUri}
            pageIndex={pageIndex}
            widthPx={requestWidth}
            width={width}
            height={pageHeight}
            colorMode={colorMode}
            crop={crop}
          />
          <Text style={[styles.pageNumber, speakingPage === pageIndex ? styles.pageNumberSpeaking : null]}>
            {speakingPage === pageIndex ? `🔊 ${pageIndex + 1}` : pageIndex + 1}
          </Text>
        </Pressable>
      )}
    />
    </View>
  );
});

/**
 * Memoizado: durante la reproducción, la posición del audio actualiza estados
 * del lector ~4 veces por segundo; sin memo, cada tick re-renderizaba la lista
 * entera de páginas y congelaba la UI.
 */
export const PdfPageList = memo(PdfPageListInner, (prev, next) =>
  prev.bookId === next.bookId &&
  prev.sourceUri === next.sourceUri &&
  prev.pageCount === next.pageCount &&
  prev.pageAspect === next.pageAspect &&
  prev.crop === next.crop &&
  prev.colorMode === next.colorMode &&
  prev.initialPage === next.initialPage &&
  prev.colors === next.colors &&
  prev.onPageChange === next.onPageChange &&
  prev.onTap === next.onTap &&
  prev.onLongPressPage === next.onLongPressPage &&
  (prev.speakingPage ?? null) === (next.speakingPage ?? null),
);

const styles = StyleSheet.create({
  measure: {
    flex: 1,
  },
  pageWrap: {
    alignItems: 'center',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 12,
    color: '#8a8a8a',
  },
  // El número de la página que la voz lee se destaca (🔊 + color).
  pageNumberSpeaking: {
    backgroundColor: 'rgba(95,140,132,0.95)',
  },
  // Autocontenido (oscuro + blanco): legible sobre la página en cualquier tema.
  pageNumber: {
    position: 'absolute',
    bottom: 10,
    left: 12,
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
