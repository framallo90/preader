/**
 * Altos de los bloques del modo texto para la lista virtualizada.
 *
 * Una FlatList con `initialScrollIndex` necesita saber dónde empieza cada ítem
 * (`getItemLayout`). Sin eso, React Native arranca con un espaciador de alto cero
 * arriba del bloque destino y, cuando mide las celdas, el contenido se corre y la
 * vista termina en cualquier lado (o en un bucle de reintentos).
 *
 * Acá cada bloque tiene un alto ESTIMADO por su largo de texto y, apenas se
 * dibuja, el alto MEDIDO. Los offsets salen de sumas acumuladas: lo medido es
 * exacto y lo estimado, cercano. Así la posición inicial es determinista y la
 * detección de "qué bloque estás viendo" (progreso) usa alturas reales.
 */
import { TextBlock } from '../types/document';

export type BlockLayoutParams = {
  fontSize: number;
  lineHeightScale: number;
  /** Ancho disponible para el texto, en puntos (ya sin márgenes ni padding). */
  textWidth: number;
  /** Padding vertical del bloque + separación con el siguiente. */
  verticalExtra: number;
};

// Ancho medio de un carácter respecto del tamaño de letra (sans del sistema).
const AVERAGE_CHAR_WIDTH = 0.5;

export function estimateBlockHeight(text: string, params: BlockLayoutParams): number {
  const lineHeight = Math.round(params.fontSize * params.lineHeightScale);
  const charsPerLine = Math.max(12, Math.floor(params.textWidth / (params.fontSize * AVERAGE_CHAR_WIDTH)));
  // Cada renglón "duro" del bloque ocupa al menos una línea.
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
  }
  return lines * lineHeight + params.verticalExtra;
}

export type ItemLayout = { length: number; offset: number; index: number };

/**
 * Cache de altos con sumas acumuladas perezosas: medir un bloque invalida los
 * offsets desde ahí en adelante, y se recalculan recién cuando alguien los pide.
 */
export class BlockLayoutCache {
  private heights: Float64Array;
  private offsets: Float64Array;
  private measured: Uint8Array;
  private validUntil = 0; // offsets válidos para índices < validUntil

  constructor(blocks: TextBlock[], params: BlockLayoutParams) {
    const count = blocks.length;
    this.heights = new Float64Array(count);
    this.offsets = new Float64Array(count + 1);
    this.measured = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      this.heights[i] = estimateBlockHeight(blocks[i].text, params);
    }
  }

  get count(): number {
    return this.heights.length;
  }

  /** Alto real de un bloque ya dibujado. Devuelve true si cambió algo. */
  measure(index: number, height: number): boolean {
    if (index < 0 || index >= this.heights.length || !(height > 0)) return false;
    const rounded = Math.round(height * 2) / 2;
    if (this.measured[index] === 1 && this.heights[index] === rounded) return false;
    this.heights[index] = rounded;
    this.measured[index] = 1;
    if (index < this.validUntil) this.validUntil = index;
    return true;
  }

  isMeasured(index: number): boolean {
    return this.measured[index] === 1;
  }

  private ensureOffsets(upTo: number) {
    const limit = Math.min(upTo, this.heights.length);
    if (this.validUntil >= limit) return;
    let acc = this.validUntil === 0 ? 0 : this.offsets[this.validUntil];
    for (let i = this.validUntil; i < limit; i++) {
      this.offsets[i] = acc;
      acc += this.heights[i];
    }
    this.offsets[limit] = acc;
    this.validUntil = limit;
  }

  getItemLayout(index: number): ItemLayout {
    const safe = Math.min(Math.max(index, 0), Math.max(this.heights.length - 1, 0));
    this.ensureOffsets(safe + 1);
    return { length: this.heights[safe] ?? 0, offset: this.offsets[safe] ?? 0, index };
  }

  /** Alto total estimado del contenido. */
  totalHeight(): number {
    this.ensureOffsets(this.heights.length);
    return this.offsets[this.heights.length];
  }
}
