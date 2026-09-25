import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Book } from '../types/storage';
import { getDisplayTitle } from '../utils/bookDisplay';
import { ThemeColors, radius } from '../utils/theme';
import { AppButton } from './AppButton';
import { Icon } from './ui';

/**
 * Acomodar los libros de una carpeta a mano.
 *
 * Se hace en una lista de UNA columna y no arrastrando en la grilla de tres, a
 * propósito: la grilla no tiene alto de fila fijo (el título ocupa una o dos
 * líneas) y mover un libro obliga a re-armar todas sus filas, así que el
 * arrastre ahí sale caro y frágil. Acá cada fila mide lo mismo, así que saber
 * sobre cuál estás parado es una división, y no hacen falta dependencias
 * nuevas: `PanResponder` y `Animated` vienen en React Native. (La librería
 * habitual arrastra `reanimated` + `gesture-handler`: +2 MB por arquitectura y
 * un segundo motor de JavaScript que arranca siempre, se use o no.)
 *
 * Se arrastra desde el asa de la derecha. Así el resto de la fila queda libre y
 * la lista se sigue scrolleando con el dedo como siempre.
 */

/** Alto de cada fila. Fijo a propósito: es lo que hace barato el arrastre. */
const ROW = 68;
/** A esta distancia del borde, la lista empieza a correrse sola. */
const EDGE = 90;
/** Cuánto se corre por tick mientras arrastrás contra el borde. */
const AUTOSCROLL_STEP = 14;

type Props = {
  visible: boolean;
  /** Nombre de la carpeta o subcarpeta que se está acomodando. */
  title: string;
  books: Book[];
  colors: ThemeColors;
  onCancel: () => void;
  onSave: (ordered: Book[]) => void;
};

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  const copia = [...list];
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
}

export function ReorderSheet({ visible, title, books, colors, onCancel, onSave }: Props) {
  const [order, setOrder] = useState<Book[]>(books);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;

  // Todo lo que el gesto necesita leer sin re-crearse en cada movimiento.
  const drag = useRef({ startIndex: 0, startScroll: 0, targetIndex: 0, dy: 0, fingerY: 0 }).current;
  const orderRef = useRef(order);
  orderRef.current = order;
  const baseRef = useRef<Book[]>(books);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportRef = useRef(0);
  // Dónde empieza la lista EN LA PANTALLA (el dedo se mide en pageY) y cuánto
  // contenido hay: sin esto la zona de abajo se disparaba un tercio antes del
  // borde, y contra el final la fila "se iba volando" porque el scroll seguía
  // sumando aunque la lista ya no se moviera.
  const viewportTopRef = useRef(0);
  const contentHeightRef = useRef(0);
  const autoscrollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Al abrirse para otra carpeta, se arranca de su orden actual.
  useEffect(() => {
    if (visible) {
      setOrder(books);
      baseRef.current = books;
      setDragId(null);
    }
  }, [visible, books]);

  const detener = useCallback(() => {
    if (autoscrollRef.current) {
      clearInterval(autoscrollRef.current);
      autoscrollRef.current = null;
    }
  }, []);

  useEffect(() => detener, [detener]);

  /** Recalcula dónde cae el libro arrastrado, contando también lo que se scrolleó. */
  const recolocar = useCallback(() => {
    const total = baseRef.current.length;
    if (total === 0) return;
    const corrimiento = drag.dy + (scrollYRef.current - drag.startScroll);
    const destino = Math.min(
      Math.max(drag.startIndex + Math.round(corrimiento / ROW), 0),
      total - 1,
    );
    if (destino !== drag.targetIndex) {
      drag.targetIndex = destino;
      setOrder(moveItem(baseRef.current, drag.startIndex, destino));
    }
    // La fila sigue al dedo: se le descuenta lo que ya se movió al reacomodar.
    dragY.setValue(corrimiento - (destino - drag.startIndex) * ROW);
  }, [drag, dragY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          // El asa ya dejó anotado en `drag` desde qué fila arranca.
          baseRef.current = orderRef.current;
          drag.startScroll = scrollYRef.current;
          drag.dy = 0;
          dragY.setValue(0);
        },
        onPanResponderMove: (event, state) => {
          drag.dy = state.dy;
          drag.fingerY = event.nativeEvent.pageY;
          recolocar();

          // Contra el borde, la lista se corre sola para poder llegar lejos.
          const arriba = drag.fingerY < viewportTopRef.current + EDGE;
          const abajo = viewportRef.current > 0 && drag.fingerY > viewportTopRef.current + viewportRef.current - EDGE;
          if ((arriba || abajo) && !autoscrollRef.current) {
            autoscrollRef.current = setInterval(() => {
              const paso = drag.fingerY < viewportTopRef.current + EDGE ? -AUTOSCROLL_STEP : AUTOSCROLL_STEP;
              const tope = Math.max(contentHeightRef.current - viewportRef.current, 0);
              const siguiente = Math.min(Math.max(scrollYRef.current + paso, 0), tope);
              scrollRef.current?.scrollTo({ y: siguiente, animated: false });
              scrollYRef.current = siguiente;
              recolocar();
            }, 16);
          } else if (!arriba && !abajo) {
            detener();
          }
        },
        onPanResponderRelease: () => {
          detener();
          setDragId(null);
          dragY.setValue(0);
          baseRef.current = orderRef.current;
        },
        onPanResponderTerminate: () => {
          detener();
          setDragId(null);
          dragY.setValue(0);
        },
      }),
    [drag, dragY, recolocar, detener],
  );

  const empezar = useCallback((index: number, book: Book) => {
    drag.startIndex = index;
    drag.targetIndex = index;
    setDragId(book.id);
  }, [drag]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.heading, { color: colors.text }]} numberOfLines={1}>
            Acomodar {title}
          </Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Arrastrá desde el asa de la derecha. Este orden se guarda y manda sobre el nombre.
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          scrollEnabled={dragId === null}
          scrollEventThrottle={16}
          onScroll={(event) => { scrollYRef.current = event.nativeEvent.contentOffset.y; }}
          onLayout={(event) => {
            viewportRef.current = event.nativeEvent.layout.height;
            const node = scrollRef.current?.getNativeScrollRef?.() as
              | { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }
              | undefined;
            node?.measureInWindow?.((_x, y) => { viewportTopRef.current = y; });
          }}
          onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
        >
          {order.map((book, index) => {
            const arrastrando = book.id === dragId;
            return (
              <Animated.View
                key={book.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: arrastrando ? colors.surfaceMuted : colors.surface,
                    borderColor: colors.border,
                  },
                  arrastrando
                    ? { transform: [{ translateY: dragY }], zIndex: 2, elevation: 6, opacity: 0.97 }
                    : null,
                ]}
              >
                <Text style={[styles.position, { color: colors.textMuted }]}>{index + 1}</Text>
                {book.coverUri ? (
                  <Image source={{ uri: book.coverUri }} style={styles.cover} contentFit="cover" />
                ) : (
                  <View style={[styles.cover, { backgroundColor: colors.accent }]} />
                )}
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {getDisplayTitle(book)}
                </Text>
                {/* El asa: sólo acá se arrastra, así el resto de la fila deja
                    scrollear la lista con el dedo. */}
                <View
                  style={styles.handle}
                  onTouchStart={() => empezar(index, book)}
                  {...panResponder.panHandlers}
                >
                  <Icon name="reorder-three-outline" size={26} color={colors.textMuted} />
                </View>
              </Animated.View>
            );
          })}
        </ScrollView>

        <View style={[styles.actions, { borderColor: colors.border }]}>
          <AppButton label="Cancelar" onPress={onCancel} variant="secondary" colors={colors} compact />
          <AppButton label="Guardar orden" icon="checkmark" onPress={() => onSave(order)} colors={colors} compact />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 44 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 4 },
  heading: { fontSize: 20, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 16 },
  row: {
    height: ROW - 8,
    marginBottom: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 10,
  },
  position: { width: 22, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  cover: { width: 34, height: 46, borderRadius: 4 },
  title: { flex: 1, fontSize: 14, fontWeight: '600' },
  handle: { paddingHorizontal: 6, paddingVertical: 10 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
