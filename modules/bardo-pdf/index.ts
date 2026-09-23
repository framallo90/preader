import { NativeModule, requireNativeModule } from 'expo';

export type PdfInfo = {
  pageCount: number;
  /** ancho/alto de la primera página; null si no se pudo medir. */
  pageAspect: number | null;
};

export type PdfColorMode = 'day' | 'night' | 'sepia' | 'warm';

/** [left, top, right, bottom] como fracción de la página (0..1). */
export type PdfCropBox = [number, number, number, number];

export type PdfOutlineItem = { title: string; pageIndex: number; level: number };

export type PdfExtraction = {
  /** Una entrada por página: el índice ES el número de página. */
  pages: string[];
  /** Índice real del documento (marcadores del PDF); vacío si no trae. */
  outline: PdfOutlineItem[];
  title: string | null;
  author: string | null;
  /** "Subject" del PDF: es donde los editores ponen la sinopsis. */
  subject: string | null;
};

export type PdfExtractProgress = { uri: string; done: number; total: number };

type BardoPdfEvents = {
  extractProgress: (payload: PdfExtractProgress) => void;
};

declare class BardoPdfNativeModule extends NativeModule<BardoPdfEvents> {
  getInfoAsync(uri: string): Promise<PdfInfo>;
  renderPageAsync(
    uri: string,
    pageIndex: number,
    widthPx: number,
    colorMode: PdfColorMode | null,
    crop: number[] | null,
    outputPath: string,
  ): Promise<string>;
  detectContentBoxAsync(uri: string): Promise<number[]>;
  /**
   * Dónde cae un texto dentro de una página, en coordenadas 0..1 (izquierda,
   * arriba, derecha, abajo). `hint` es una pista de 0 a 1 de por dónde está:
   * una misma palabra puede repetirse en la página y se elige la más cercana.
   * Devuelve un rectángulo por renglón, o vacío si no lo encuentra.
   */
  pageTextRectsAsync(uri: string, pageIndex: number, needle: string, hint: number): Promise<number[][]>;
  textAtPointAsync(
    uri: string,
    pageIndex: number,
    x: number,
    y: number,
  ): Promise<{ text: string; charInPage: number } | null>;
  extractPagesAsync(uri: string): Promise<PdfExtraction>;
  /** El color que manda en una imagen de tapa ("#RRGGBB"), o null si es casi gris. */
  coverColorAsync(path: string): Promise<string | null>;
  closeAsync(): Promise<void>;
}

let cachedModule: BardoPdfNativeModule | null = null;

export function getBardoPdfModule() {
  if (!cachedModule) {
    cachedModule = requireNativeModule<BardoPdfNativeModule>('BardoPdf');
  }
  return cachedModule;
}

export function isBardoPdfAvailable(): boolean {
  try {
    getBardoPdfModule();
    return true;
  } catch {
    return false;
  }
}
