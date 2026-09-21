/**
 * Salto pendiente hacia una posición del libro. La pantalla "Sobre este libro"
 * (o cualquier otra) lo pide y el lector lo consume al abrirse o al volver a
 * tener foco. Evita depender de cómo el router propaga parámetros entre
 * pantallas ya montadas.
 */
let pending: { bookId: string; charIndex: number } | null = null;

export const readerJumpStore = {
  request(bookId: string, charIndex: number) {
    pending = { bookId, charIndex };
  },

  /** Devuelve el salto pendiente para ESTE libro y lo descarta. */
  consume(bookId: string): number | null {
    if (!pending || pending.bookId !== bookId) return null;
    const { charIndex } = pending;
    pending = null;
    return charIndex;
  },
};
