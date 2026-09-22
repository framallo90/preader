/**
 * Salto pendiente hacia una posición del libro. La pantalla "Sobre este libro"
 * (o cualquier otra) lo pide y el lector lo consume al abrirse o al volver a
 * tener foco. Evita depender de cómo el router propaga parámetros entre
 * pantallas ya montadas.
 */
type PendingJump = { bookId: string; charIndex: number | null; listen: boolean };

let pending: PendingJump | null = null;

export const readerJumpStore = {
  /** Pide abrir el libro en una posición y, si se quiere, empezar a escuchar. */
  request(bookId: string, charIndex: number | null, listen = false) {
    pending = { bookId, charIndex, listen };
  },

  /** Devuelve el salto pendiente para ESTE libro y lo descarta. */
  consume(bookId: string): number | null {
    if (!pending || pending.bookId !== bookId) return null;
    const { charIndex } = pending;
    pending = null;
    return charIndex;
  },

  /**
   * Igual que consume() pero devuelve también si hay que arrancar la voz.
   * Lo usa el lector, que necesita las dos cosas de una sola lectura (consumir
   * dos veces perdería la primera).
   */
  consumeRequest(bookId: string): { charIndex: number | null; listen: boolean } | null {
    if (!pending || pending.bookId !== bookId) return null;
    const { charIndex, listen } = pending;
    pending = null;
    return { charIndex, listen };
  },
};
