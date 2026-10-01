/**
 * Restaurar la escucha después de un reinicio de la app.
 *
 * Si la app se cerró (o Android la mató) mientras se escuchaba un libro, al
 * volver a abrirla ese libro queda cargado en pausa, en su posición: la
 * tarjeta del Inicio dice "Listo para seguir" y su play suena al instante.
 * No se abre la notificación ni se toman los botones de medios: eso recién
 * pasa cuando el usuario da play.
 *
 * Corre de fondo, después de que el Inicio ya se mostró (abrir tiene que ser
 * instantáneo), y si algo falta (el libro, su caché de texto) no hace nada.
 */
import { bookProgressRepository } from '../storage/bookProgressRepository';
import { bookRepository } from '../storage/bookRepository';
import { parsedDocumentRepository } from '../storage/parsedDocumentRepository';
import { runtimeStateRepository } from '../storage/runtimeStateRepository';
import { AppSettings } from '../types/storage';
import { resolveSavedPosition } from '../utils/progressRemap';
import { documentAudioPlaybackService } from './documentAudioPlaybackService';

/** Hasta cuánto después de la última escucha se restaura (12 horas). */
const RESTORE_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function restoreAudioSessionIfAny(
  settings: Pick<AppSettings, 'defaultVoiceId' | 'defaultRate'>,
): Promise<boolean> {
  const bookId = await runtimeStateRepository.getAudioSessionBookId();
  if (!bookId) return false;
  // Ya hay algo cargado o sonando (el usuario fue más rápido): no se toca.
  if (documentAudioPlaybackService.getSnapshot().documentId) return false;

  const book = await bookRepository.getBookById(bookId);
  if (!book) {
    await runtimeStateRepository.setAudioSessionBookId(null);
    return false;
  }
  // Sólo desde el caché: si el texto no está preparado no se lo extrae acá,
  // que es el arranque de la app. Se reintenta en el próximo arranque.
  const document = await parsedDocumentRepository.getParsedDocument(book);
  if (!document || document.fullText.length === 0 || (document.pdf && !document.pdf.hasText)) return false;

  const progress = await bookProgressRepository.getProgress(bookId);
  // Sólo una escucha reciente: volver a la app al día siguiente y encontrar
  // el libro "listo para seguir" sin haberlo pedido no tiene sentido.
  const lastAt = progress ? Date.parse(progress.updatedAt) : NaN;
  if (!Number.isFinite(lastAt) || Date.now() - lastAt > RESTORE_WINDOW_MS) {
    await runtimeStateRepository.setAudioSessionBookId(null);
    return false;
  }
  const position = resolveSavedPosition(document, progress);
  await documentAudioPlaybackService.restoreSession(
    document,
    position.blockIndex,
    position.charIndex,
    book.voiceId ?? settings.defaultVoiceId,
    book.rate ?? settings.defaultRate,
    { title: document.fileName, artist: 'Bardo' },
  );
  return true;
}
