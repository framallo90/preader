/**
 * pdfTextPreparationService.ts
 *
 * Prepara el texto de un PDF DE FONDO, con el libro ya abierto. Abrir un PDF no
 * espera a esto: las páginas se leen desde el primer instante y la voz, la búsqueda
 * y el índice se habilitan cuando el texto está listo.
 *
 * Vive fuera del lector a propósito: si el usuario sale del libro a mitad de
 * camino, el trabajo termina igual y la próxima apertura ya encuentra el caché.
 */
import { chapterRepository } from '../storage/chapterRepository';
import { noteRepository } from '../storage/noteRepository';
import { DocumentRef, parsedDocumentRepository } from '../storage/parsedDocumentRepository';
import { ParsedDocument } from '../types/document';
import { pageForProgress } from '../utils/pageMap';
import { positionForPage } from '../utils/progressRemap';
import { resolveChapters } from '../utils/resolveChapters';
import { persistBookMetadata } from './bookMetadataService';
import { buildPdfDocument, withoutText } from './pdfDocumentParser';

export type PdfTextProgress = { bookId: string; done: number; total: number };

type ReadyListener = (bookId: string, document: ParsedDocument) => void;
type ProgressListener = (progress: PdfTextProgress) => void;

const running = new Map<string, Promise<void>>();
const readyListeners = new Set<ReadyListener>();
const progressListeners = new Set<ProgressListener>();

/** Avisa cuando el documento definitivo de un libro está listo (y ya guardado). */
export function subscribePdfTextReady(listener: ReadyListener): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

export function subscribePdfTextProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

/**
 * Avisa que el texto de un libro ya está. Lo usa el lector cuando el documento
 * vino del caché en dos tiempos (primero las páginas, después el texto): el
 * camino de "texto listo" es el mismo, así que la posición se recalcula igual.
 */
export function notifyPdfTextReady(bookId: string, document: ParsedDocument): void {
  readyListeners.forEach((listener) => {
    try {
      listener(bookId, document);
    } catch {
      // Un oyente que falla no es problema de quien avisa.
    }
  });
}

/**
 * Arranca la preparación (si ya está corriendo para ese libro, no hace nada).
 * `quick` es el documento provisorio con el que se abrió el libro: si el texto no
 * se puede extraer, queda como versión final (sin voz).
 */
export function preparePdfText(book: DocumentRef, quick: ParsedDocument): void {
  if (running.has(book.id)) return;

  const task = (async () => {
    let finalDocument: ParsedDocument;
    try {
      const built = await buildPdfDocument(book.uri, (done, total) => {
        progressListeners.forEach((listener) => listener({ bookId: book.id, done, total }));
      });
      const identified: ParsedDocument = { ...built, id: book.id, fileName: book.name, sourceUri: book.uri };
      finalDocument = { ...identified, chapters: resolveChapters(book.id, identified) };

      // Guardar es aparte de EXTRAER: si la base falla (disco lleno, el libro se
      // borró mientras se preparaba), el texto ya extraído igual se usa en esta
      // sesión. Antes cualquier fallo de escritura lo tiraba y el PDF quedaba
      // "sin texto para la voz" hasta reabrir la app.
      const located = finalDocument;
      try {
        // Los marcadores y notas puestos sobre una página se re-ubican en el texto real.
        // (El progreso no hace falta tocarlo: guarda su página y se resuelve al abrir.)
        await noteRepository.relocatePagedNotes(
          book.id,
          (page) => positionForPage(located, page).absoluteCharIndex,
          (page, charIndex) =>
            located.pdf ? pageForProgress(charIndex, page, located.pdf.pageOffsets, located.fullText.length) === page : false,
        );
        await parsedDocumentRepository.saveParsedDocument(book, located);
        // Siempre, aunque no haya capítulos: si el texto cambió y ya no se
        // detecta ninguno, los de antes quedaban con offsets viejos.
        await chapterRepository.saveChaptersForBook(book.id, located.chapters);
        if (built.metadata) await persistBookMetadata(book.id, built.metadata);
      } catch {
        // Se reintenta solo la próxima vez que se abra el libro.
      }
    } catch {
      // Protegido, dañado o demasiado grande: el libro se sigue leyendo por
      // páginas, sin voz. No se cachea, así una versión futura puede reintentarlo.
      finalDocument = withoutText(quick);
    }
    // Un listener que tire no debe dejar la tarea colgada ni frenar a los demás.
    readyListeners.forEach((listener) => {
      try {
        listener(book.id, finalDocument);
      } catch {
        // El lector ya se cerró o se rompió al recibirlo: no es problema de la preparación.
      }
    });
  })().finally(() => {
    running.delete(book.id);
  });

  running.set(book.id, task);
}
