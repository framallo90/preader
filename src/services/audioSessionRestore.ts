/**
 * Restaurar la escucha después de un reinicio de la app.
 *
 * Si la app se cerró (o Android la mató) mientras se escuchaba un libro, al
 * volver a abrirla no existía ninguna sesión de medios: el play de la
 * notificación, de la pantalla de bloqueo o del auricular no hacía nada hasta
 * tocar "Escuchar" adentro de la app. Acá se vuelve a dejar ese libro cargado
 * en pausa, en su posición, con la sesión armada: el play externo, y el de la
 * tarjeta del Inicio, vuelven a funcionar.
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
