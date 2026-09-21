import { NativeModule, requireNativeModule } from 'expo';

export type PdfInfo = {
  pageCount: number;
  /** ancho/alto de la primera página; null si no se pudo medir. */
  pageAspect: number | null;
};

export type PdfColorMode = 'day' | 'night' | 'sepia';

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
  extractPagesAsync(uri: string): Promise<PdfExtraction>;
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
