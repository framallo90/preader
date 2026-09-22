import { NativeModule, requireNativeModule } from 'expo';

export type ComicInfo = {
  pageCount: number;
  /** ancho/alto típico de las páginas; null si no se pudo medir. */
  pageAspect: number | null;
  /** zip, rar, rar5, 7z, tar… detectado por contenido, no por extensión. */
  format: string;
  solid: boolean;
};

export type DocumentTreeEntry = {
  uri: string;
  name: string;
  isDirectory: boolean;
  /** null cuando el proveedor no lo informa. */
  size: number | null;
};

export type EpubFileText = {
  text: string;
  /** id/name de cada ancla → offset dentro de `text`. */
  anchors: Record<string, number>;
};

declare class BardoArchiveNativeModule extends NativeModule {
  /** Entradas directas de una carpeta SAF autorizada, en una sola consulta. */
  listDocumentTreeAsync(treeUri: string): Promise<DocumentTreeEntry[]>;
  /** Huella de contenido `bk_…` (misma fórmula que la versión en JS). */
  fingerprintAsync(uri: string, size: number): Promise<string>;
  comicInfoAsync(uri: string): Promise<ComicInfo>;
  renderComicPageAsync(uri: string, pageIndex: number, widthPx: number, outputPath: string): Promise<string>;
  /** Texto de cada entrada pedida; null en las que no existen. */
  readTextAsync(uri: string, paths: string[]): Promise<(string | null)[]>;
  /** Capítulos de un EPUB como texto plano normalizado + posición de cada ancla en ese texto. */
  readEpubTextsAsync(uri: string, paths: string[]): Promise<(EpubFileText | null)[]>;
  /** Copia una entrada a outputPath; null si no existe. */
  extractEntryAsync(uri: string, path: string, outputPath: string): Promise<string | null>;
  closeAsync(): Promise<void>;
}

let cachedModule: BardoArchiveNativeModule | null = null;

export function getBardoArchiveModule() {
  if (!cachedModule) {
    cachedModule = requireNativeModule<BardoArchiveNativeModule>('BardoArchive');
  }
  return cachedModule;
}

export function isBardoArchiveAvailable(): boolean {
  try {
    getBardoArchiveModule();
    return true;
  } catch {
    return false;
  }
}
