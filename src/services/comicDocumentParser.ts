import { DocumentParser, ParsedDocument } from '../types/document';
import { buildPagePlaceholders } from '../utils/pdfPages';
import { buildTextBlocks } from '../utils/textBlocks';
import { DocumentParseError } from './documentParser';
import { getComicInfo, isComicReaderAvailable } from './pdfLocalService';

/**
 * Cómics: CBZ, CBR (RAR 4 y 5), CB7 y CBT. El contenedor se reconoce por su
 * contenido, así que un .cbr que en realidad es un zip abre igual.
 *
 * Abrir es leer el índice del archivo: cada página se saca recién al mostrarse.
 * Para el resto de la app un cómic es un libro por páginas sin texto (como un PDF
 * escaneado): mismo progreso, marcadores, notas, estados y colecciones.
 */
class ComicDocumentParser implements DocumentParser {
  async parse(uri: string): Promise<ParsedDocument> {
    if (!isComicReaderAvailable()) {
      throw new DocumentParseError('extractor_unavailable', 'La build actual no incluye el lector de cómics.');
    }

    let info;
    try {
      info = await getComicInfo(uri);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'No se pudo abrir el cómic.';
      throw new DocumentParseError('parse_failed', message);
    }
    if (info.pageCount <= 0) {
      throw new DocumentParseError('empty_document', 'El archivo no contiene imágenes.');
    }

    const { fullText, pageOffsets } = buildPagePlaceholders(info.pageCount);
    const fileName = uri.split('/').pop() ?? 'comic';
    return {
      id: fileName,
      fileName,
      sourceUri: uri,
      fullText,
      blocks: buildTextBlocks(fullText),
      chapters: [],
      pdf: {
        kind: 'comic',
        pageCount: info.pageCount,
        pageAspect: info.pageAspect,
        pageOffsets,
        crop: null,
        outline: [],
        hasText: false,
      },
    };
  }
}

export const comicDocumentParser = new ComicDocumentParser();
