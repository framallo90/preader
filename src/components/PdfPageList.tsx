import { Image } from 'expo-image';
import { ForwardedRef, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PDF_RENDER_CANCELLED, PageSourceKind, PageTextRect, PdfColorMode, PdfCropBox, canonicalPageWidthPx, requestPdfPage } from '../services/pdfLocalService';
import { ThemeColors } from '../utils/theme';
import { Icon } from './ui';

type PdfPageListProps = {
  bookId: string;
  /** De dónde salen las páginas: un PDF (por defecto) o un cómic. */
  kind?: PageSourceKind;
  /** Archivo (file:// o content://) del que se sacan las páginas. */
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
  /** Toque simple en el CENTRO de la página (p. ej. alternar pantalla completa). */
  onTap?: () => void;
  /** Tocar los bordes izquierdo/derecho pasa de página. */
  tapEdgesTurnPage?: boolean;
  /** Pasar de costado, una página por vez, en vez de scrollear en vertical. */
  horizontal?: boolean;
  /**
   * Mantener apretado sobre una página. `x` e `y` van de 0 a 1 sobre la página
   * ENTERA (sin recorte y sin zoom), para poder citar el texto de ese punto.
   */
  onLongPressPage?: (pageIndex: number, x: number, y: number) => void;
  /** Página que la voz está leyendo ahora (su número se marca con 🔊). */
  speakingPage?: number | null;
  /**
   * Dónde cae en esa página lo que la voz está diciendo, en coordenadas 0..1.
   * Se pinta encima de la imagen: es el equivalente a ver la palabra resaltada
   * en el modo texto, pero sobre la página dibujada (incluso si es un escaneo).
   */
  speakingRects?: PageTextRect[] | null;
  /**
   * En qué página caen esos rectángulos. Puede NO ser `speakingPage`: la
   * página "de la voz" va unos caracteres adelantada para pasar la hoja a
   * tiempo, y las últimas palabras de cada página quedaban buscándose en la
   * página siguiente (y sin resaltar). Si no viene, se usa `speakingPage`.
   */
  speakingRectsPage?: number | null;
};

export type PdfPageListHandle = {
  /** Salta directo a una página (para el scrubber). */
  scrollToPage: (pageIndex: number) => void;
  /** Corre la vista tantos puntos hacia abajo (auto-scroll). */
  scrollBy: (offset: number) => void;
};

/** Hasta dónde se puede agrandar una página con los dedos. */
const MAX_ZOOM = 4;
/** Debajo de esto se considera "sin zoom" y la lista vuelve a scrollear. */
const MIN_ZOOM = 1.05;
/** Con más zoom que esto se vuelve a dibujar la página a más resolución. */
const REDRAW_ZOOM = 1.3;

const DEFAULT_ASPECT = 0.707;
const PAGE_GAP = 8;

const PAGE_BACKGROUND: Record<PdfColorMode, string> = {
  day: '#ffffff',
  sepia: '#f4ecd8',
  night: '#121212',
  warm: '#1b1511',
};

type PdfPageImageProps = {
  bookId: string;
  kind: PageSourceKind;
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
  kind,
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
    const ticket = requestPdfPage({ bookId, kind, uri: sourceUri, pageIndex, widthPx, colorMode, crop });
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
  }, [bookId, kind, sourceUri, pageIndex, widthPx, colorMode, crop]);

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
/** Distancia entre los dos dedos, para el zoom. */
function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.hypot(dx, dy);
}

/**
 * Pasa un rectángulo de la página entera al marco de lo que se está viendo.
 * Con recorte de márgenes activo, la imagen ES la caja de contenido: sin esta
 * conversión el resaltado queda corrido (y fuera de la caja, invisible).
 */
function toVisibleRect(rect: PageTextRect, crop: PdfCropBox | null): PageTextRect | null {
  if (!crop) return rect;
  const [cl, ct, cr, cb] = crop;
  const anchoCaja = cr - cl;
  const altoCaja = cb - ct;
  if (anchoCaja <= 0 || altoCaja <= 0) return rect;
  const left = (rect[0] - cl) / anchoCaja;
  const top = (rect[1] - ct) / altoCaja;
  const right = (rect[2] - cl) / anchoCaja;
  const bottom = (rect[3] - ct) / altoCaja;
  // Lo que cae afuera de la caja recortada no se ve.
  if (right <= 0 || left >= 1 || bottom <= 0 || top >= 1) return null;
  return [Math.max(left, 0), Math.max(top, 0), Math.min(right, 1), Math.min(bottom, 1)];
}

/**
 * Lo inverso de toVisibleRect: un punto de lo que se ve, llevado a coordenadas
 * de la página entera. Con recorte de márgenes, la imagen ES la caja de
 * contenido, así que sin esto el punto cae varios renglones más arriba.
 */
function toPagePoint(x: number, y: number, crop: PdfCropBox | null): [number, number] {
  if (!crop) return [x, y];
  const [cl, ct, cr, cb] = crop;
  return [cl + x * (cr - cl), ct + y * (cb - ct)];
}

const PdfPageListInner = forwardRef(function PdfPageList(
  {
    bookId,
    kind = 'pdf',
    sourceUri,
    pageCount,
    pageAspect,
    crop,
    colorMode,
    initialPage,
    colors,
    onPageChange,
    onTap,
    tapEdgesTurnPage = false,
    horizontal = false,
    onLongPressPage,
    speakingPage,
    speakingRects,
    speakingRectsPage,
  }: PdfPageListProps,
  ref: ForwardedRef<PdfPageListHandle>,
) {
  // El ancho de página es el del CONTENEDOR. El lector vive en una tarjeta con
  // márgenes y borde: usando el ancho de la ventana la imagen desbordaba ~22 px y
  // se recortaba del lado derecho. Con márgenes blancos no se notaba; con el
  // recorte de márgenes se comía el final de cada renglón.
  const { width: windowWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const width = containerWidth ?? windowWidth;
  const listRef = useRef<FlatList<number>>(null);
  const currentPageRef = useRef(Math.min(Math.max(initialPage, 0), pageCount - 1));
  // Ref para no capturar un callback viejo en el onScroll.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const baseAspect = pageAspect && pageAspect > 0.2 && pageAspect < 5 ? pageAspect : DEFAULT_ASPECT;
  // Con recorte, la proporción visible es la de la caja de contenido.
  const aspect = crop ? (baseAspect * (crop[2] - crop[0])) / (crop[3] - crop[1]) : baseAspect;
  // En vertical la hoja ocupa todo el ancho y se scrollea lo que sobre de alto.
  // De costado no hay scroll vertical: si la hoja no entra alta, se achica hasta
  // entrar, como pasar una página de verdad.
  const fullHeight = Math.round(width / aspect);
  const shrinkToFit = horizontal && containerHeight > 0 && fullHeight > containerHeight;
  const pageWidth = shrinkToFit ? Math.round(containerHeight * aspect) : width;
  const pageHeight = shrinkToFit ? Math.round(pageWidth / aspect) : fullHeight;
  // Mismo ancho que usa el pre-render de la página inicial (ver reader.tsx): la
  // imagen ya está lista cuando la lista se monta.
  const requestWidth = canonicalPageWidthPx();

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i), [pageCount]);

  // ── Zoom con los dedos ───────────────────────────────────────────────────
  //
  // Se agranda UNA página (la que estás mirando), no la lista entera: con una
  // lista virtualizada, transformar el contenedor rompe las cuentas del scroll.
  // Mientras hay zoom, la lista no scrollea y el arrastre mueve DENTRO de la
  // página. Se hace con PanResponder y Animated, que vienen en React Native:
  // no hace falta ninguna dependencia nueva, y sin zoom no cuesta nada.
  const [zoomedPage, setZoomedPage] = useState<number | null>(null);
  // El nivel ya asentado, para pedir la página a más resolución.
  const [zoomLevel, setZoomLevel] = useState(1);
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const gesture = useRef({ scale: 1, x: 0, y: 0, startDistance: 0, startScale: 1, startX: 0, startY: 0 }).current;

  const resetZoom = useCallback(() => {
    gesture.scale = 1;
    gesture.x = 0;
    gesture.y = 0;
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    setZoomedPage(null);
    setZoomLevel(1);
  }, [gesture, scale, translateX, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Los toques simples siguen siendo del Pressable (pantalla completa,
        // bordes para pasar de página, mantener apretado).
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (event, state) =>
          event.nativeEvent.touches.length === 2 ||
          (gesture.scale > MIN_ZOOM && (Math.abs(state.dx) > 3 || Math.abs(state.dy) > 3)),
        onPanResponderGrant: (event) => {
          gesture.startScale = gesture.scale;
          gesture.startX = gesture.x;
          gesture.startY = gesture.y;
          gesture.startDistance = touchDistance(event.nativeEvent.touches);
        },
        onPanResponderMove: (event, state) => {
          const touches = event.nativeEvent.touches;
          if (touches.length === 2) {
            const distance = touchDistance(touches);
            if (gesture.startDistance <= 0) {
              gesture.startDistance = distance;
              return;
            }
            const next = Math.min(Math.max((gesture.startScale * distance) / gesture.startDistance, 1), MAX_ZOOM);
            gesture.scale = next;
            scale.setValue(next);
          } else if (gesture.scale > MIN_ZOOM) {
            // Se arrastra dentro de la página, sin salirse de sus bordes.
            const limitX = (pageWidth * (gesture.scale - 1)) / 2;
            const limitY = (pageHeight * (gesture.scale - 1)) / 2;
            gesture.x = Math.min(Math.max(gesture.startX + state.dx, -limitX), limitX);
            gesture.y = Math.min(Math.max(gesture.startY + state.dy, -limitY), limitY);
            translateX.setValue(gesture.x);
            translateY.setValue(gesture.y);
          }
        },
        onPanResponderRelease: () => {
          gesture.startDistance = 0;
          if (gesture.scale <= MIN_ZOOM) {
            resetZoom();
            return;
          }
          // Al soltar, se recentra dentro de los límites y se pide la página a
          // más resolución si hace falta.
          setZoomedPage(currentPageRef.current);
          setZoomLevel(gesture.scale);
        },
      }),
    [gesture, scale, translateX, translateY, pageWidth, pageHeight, resetZoom],
  );

  // Cambiar de libro, de recorte o de ancho: el zoom se suelta.
  useEffect(() => {
    resetZoom();
  }, [bookId, crop, width, resetZoom]);

  // Offset de scroll al día, para poder correr la vista de a poco.
  const scrollOffsetRef = useRef(0);

  useImperativeHandle(ref, () => ({
    scrollToPage: (pageIndex: number) => {
      const target = Math.min(Math.max(pageIndex, 0), pageCount - 1);
      currentPageRef.current = target;
      listRef.current?.scrollToIndex({ index: target, animated: false });
      onPageChange?.(target);
    },
    scrollBy: (offset: number) => {
      listRef.current?.scrollToOffset({ offset: scrollOffsetRef.current + offset, animated: false });
    },
  }), [pageCount, onPageChange]);

  // Página actual calculada directo del offset de scroll (medidas uniformes):
  // más confiable que onViewableItemsChanged, que a veces no dispara. De costado
  // cada página ocupa el ancho de la pantalla; en vertical, su alto más el hueco.
  const itemLength = horizontal ? width : pageHeight + PAGE_GAP;
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number; y: number } } }) => {
      const offset = horizontal ? event.nativeEvent.contentOffset.x : event.nativeEvent.contentOffset.y;
      scrollOffsetRef.current = offset;
      const page = Math.min(pageCount - 1, Math.max(0, Math.round(offset / itemLength)));
      if (page !== currentPageRef.current) {
        currentPageRef.current = page;
        onPageChangeRef.current?.(page);
      }
    },
    [itemLength, pageCount, horizontal],
  );

  // Tocar los bordes pasa de página; el centro sigue siendo pantalla completa.
  // La franja del borde es angosta (un cuarto de cada lado) para que el gesto
  // de siempre —tocar la página— siga cayendo en el centro.
  // Doble toque en el centro: amplía o vuelve al tamaño normal.
  //
  // El toque simple NO espera a ver si viene el segundo: responde en el acto y,
  // si el segundo llega, se deshace. Hacerlo al revés (esperar ~300 ms antes de
  // mostrar u ocultar los controles) se siente pesado en el gesto que más se usa.
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_ZOOM = 2.5;
  const lastCenterTapRef = useRef(0);

  const zoomTo = useCallback(
    (pageIndex: number, level: number) => {
      gesture.scale = level;
      gesture.x = 0;
      gesture.y = 0;
      scale.setValue(level);
      translateX.setValue(0);
      translateY.setValue(0);
      setZoomedPage(level > MIN_ZOOM ? pageIndex : null);
      setZoomLevel(level);
    },
    [gesture, scale, translateX, translateY],
  );

  const handleCenterTap = useCallback(
    (pageIndex: number) => {
      const now = Date.now();
      if (now - lastCenterTapRef.current < DOUBLE_TAP_MS) {
        // Segundo toque: era un doble toque. Se deshace lo del primero y se amplía.
        lastCenterTapRef.current = 0;
        onTap?.();
        zoomTo(pageIndex, gesture.scale > MIN_ZOOM ? 1 : DOUBLE_TAP_ZOOM);
        return;
      }
      lastCenterTapRef.current = now;
      onTap?.();
    },
    [gesture, zoomTo, onTap],
  );

  const handlePageTap = useCallback(
    (locationX: number, pageIndex: number) => {
      if (!tapEdgesTurnPage || width <= 0) {
        handleCenterTap(pageIndex);
        return;
      }
      const edge = width * 0.25;
      const target = locationX < edge ? pageIndex - 1 : locationX > width - edge ? pageIndex + 1 : null;
      if (target === null) {
        handleCenterTap(pageIndex);
        return;
      }
      // Con zoom, los bordes no pasan de página: estás mirando el detalle.
      if (gesture.scale > MIN_ZOOM) return;
      const clamped = Math.min(Math.max(target, 0), pageCount - 1);
      if (clamped === pageIndex) return; // ya estás en la primera o en la última
      currentPageRef.current = clamped;
      listRef.current?.scrollToIndex({ index: clamped, animated: true });
      onPageChangeRef.current?.(clamped);
    },
    [tapEdgesTurnPage, width, pageCount, handleCenterTap, gesture],
  );

  // Dónde cayó el dedo, en coordenadas de la página entera (0..1).
  //
  // Hay tres cosas que deshacer, en este orden: que la hoja esté centrada en su
  // hueco (de costado también en vertical), el zoom —que transforma la imagen
  // pero NO el Pressable que recibe el toque— y el recorte de márgenes.
  const handleLongPress = useCallback(
    (pageIndex: number, locationX: number, locationY: number) => {
      if (!onLongPressPage) return;
      const offsetX = (width - pageWidth) / 2;
      const offsetY = horizontal && containerHeight > 0 ? (containerHeight - pageHeight) / 2 : 0;
      let px = locationX - offsetX;
      let py = locationY - offsetY;
      if (zoomedPage === pageIndex && gesture.scale > 1) {
        // p = centro + (punto − centro − corrimiento) / escala
        px = pageWidth / 2 + (px - pageWidth / 2 - gesture.x) / gesture.scale;
        py = pageHeight / 2 + (py - pageHeight / 2 - gesture.y) / gesture.scale;
      }
      const vx = Math.min(Math.max(px / Math.max(pageWidth, 1), 0), 1);
      const vy = Math.min(Math.max(py / Math.max(pageHeight, 1), 0), 1);
      const [fx, fy] = toPagePoint(vx, vy, crop);
      onLongPressPage(pageIndex, fx, fy);
    },
    [onLongPressPage, width, pageWidth, pageHeight, horizontal, containerHeight, zoomedPage, gesture, crop],
  );

  const handleLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== containerWidth) setContainerWidth(measured);
    const alto = Math.round(event.nativeEvent.layout.height);
    if (alto > 0 && alto !== containerHeight) setContainerHeight(alto);
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
      // Al rotar cambia el width, y al llegar el recorte de márgenes cambia el alto de
      // página: en ambos casos la lista se remonta y retoma en la página actual.
      key={`pdf-${width}-${crop ? crop.join('_') : 'full'}-${horizontal ? 'h' : 'v'}`}
      horizontal={horizontal}
      // De costado se encaja de a una página, como pasar una hoja.
      pagingEnabled={horizontal}
      style={{ backgroundColor: colors.readerSurface }}
      scrollEnabled={zoomedPage === null}
      data={pages}
      // Las celdas de una FlatList NO se vuelven a dibujar cuando cambia algo
      // que no está en `data`. Sin esto, el resaltado de la voz (y el ícono de
      // la página que se está leyendo) se calculaban bien pero no se veían nunca.
      extraData={`${speakingPage ?? ''}:${speakingRectsPage ?? ''}:${speakingRects?.length ?? 0}:${speakingRects?.[0]?.[1] ?? ''}:${zoomedPage ?? ''}:${zoomLevel}`}
      keyExtractor={(page) => `p-${page}`}
      initialScrollIndex={currentPageRef.current}
      getItemLayout={(_, index) => ({ length: itemLength, offset: itemLength * index, index })}
      onScroll={handleScroll}
      scrollEventThrottle={80}
      windowSize={5}
      maxToRenderPerBatch={3}
      showsVerticalScrollIndicator={!horizontal}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item: pageIndex }) => (
        <Pressable
          onPress={(event) => handlePageTap(event.nativeEvent.locationX, pageIndex)}
          onLongPress={onLongPressPage
            ? (event) => handleLongPress(pageIndex, event.nativeEvent.locationX, event.nativeEvent.locationY)
            : undefined}
          delayLongPress={350}
          style={[
            styles.pageWrap,
            horizontal
              ? { width, height: pageHeight, justifyContent: 'center' }
              : { height: pageHeight + PAGE_GAP },
          ]}
          {...(zoomedPage === null || zoomedPage === pageIndex ? panResponder.panHandlers : {})}
        >
          <Animated.View
            style={
              zoomedPage === pageIndex
                ? { transform: [{ translateX }, { translateY }, { scale }] }
                : undefined
            }
          >
          <PdfPageImage
            bookId={bookId}
            kind={kind}
            sourceUri={sourceUri}
            pageIndex={pageIndex}
            // Con zoom se pide la página a más resolución: ampliar el JPEG
            // pensado para el ancho de pantalla se ve borroso. El caché de
            // páginas ya distingue por ancho, así que cada nivel se guarda solo.
            widthPx={zoomedPage === pageIndex && zoomLevel > REDRAW_ZOOM
              ? Math.min(Math.round(requestWidth * zoomLevel), 4096)
              : requestWidth}
            width={pageWidth}
            height={pageHeight}
            colorMode={colorMode}
            crop={crop}
          />
          {(speakingRectsPage ?? speakingPage) === pageIndex && speakingRects
            ? speakingRects.map((rect, at) => {
                // Los rectángulos vienen en coordenadas de la PÁGINA ENTERA,
                // pero lo que se ve puede ser la caja de contenido recortada:
                // hay que pasarlos al mismo marco o el resaltado queda corrido.
                const box = toVisibleRect(rect, crop);
                if (!box) return null;
                return (
                  <View
                    key={`voz-${at}`}
                    pointerEvents="none"
                    style={[
                      styles.speechRect,
                      {
                        // Lacre translúcido, no el color de resaltado del texto:
                        // ese es un tono del papel y sobre una página oscura
                        // (noche, noche cálida) no se veía. El lacre se ve
                        // sobre los cuatro papeles y sigue dejando leer.
                        backgroundColor: colors.warm,
                        left: box[0] * pageWidth,
                        top: box[1] * pageHeight,
                        width: Math.max((box[2] - box[0]) * pageWidth, 2),
                        height: Math.max((box[3] - box[1]) * pageHeight, 2),
                      },
                    ]}
                  />
                );
              })
            : null}
          </Animated.View>
          <View style={[styles.pageNumber, speakingPage === pageIndex ? { backgroundColor: colors.primary } : null]}>
            {speakingPage === pageIndex ? <Icon name="volume-high" size={12} color={colors.primaryText} /> : null}
            {/* Sobre el color de acento va su propio color de texto (el blanco no
                se lee sobre lila ni sobre ámbar); en la noche cálida, nada de blanco. */}
            <Text style={[styles.pageNumberText, { color: speakingPage === pageIndex ? colors.primaryText : colorMode === 'warm' ? '#E6CBA6' : '#ffffff' }]}>{pageIndex + 1}</Text>
          </View>
          {zoomedPage === pageIndex ? (
            <Pressable
              onPress={resetZoom}
              style={[styles.zoomBadge, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Quitar el zoom"
            >
              <Icon name="contract-outline" size={13} color={colors.primaryText} />
              <Text style={[styles.zoomBadgeText, { color: colors.primaryText }]}>{zoomLevel.toFixed(1)}x</Text>
            </Pressable>
          ) : null}
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
  prev.kind === next.kind &&
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
  (prev.speakingPage ?? null) === (next.speakingPage ?? null) &&
  // Los rectángulos de lo que la voz lee cambian palabra a palabra: sin esto el
  // memo se los comía y el resaltado no aparecía nunca.
  prev.speakingRects === next.speakingRects &&
  (prev.speakingRectsPage ?? null) === (next.speakingRectsPage ?? null) &&
  (prev.tapEdgesTurnPage ?? false) === (next.tapEdgesTurnPage ?? false) &&
  // Sin esto, cambiar a "pasar de costado" con el libro abierto no se veía:
  // el memo dejaba la lista dibujada como estaba.
  (prev.horizontal ?? false) === (next.horizontal ?? false),
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
  // Autocontenido (oscuro + blanco): legible sobre la página en cualquier tema.
  // La página que la voz está leyendo se pinta del color primario con un altavoz.
  // Encima de la imagen de la página, translúcido: resalta sin tapar el texto.
  speechRect: { position: 'absolute', borderRadius: 3, opacity: 0.38 },
  zoomBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  zoomBadgeText: { fontSize: 11, fontWeight: '800' },
  pageNumber: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(20,20,20,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  pageNumberText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
});
