import { createAudioPlayer } from 'expo-audio';

import { synthesizeSpeech } from './systemTtsService';
import { AnnounceableChapter, buildAnnouncement } from '../utils/chapterAnnouncement';

/** Si la sintesis o la reproduccion tardan mas que esto, se sigue sin anunciar. */
const MAX_WAIT_MS = 6000;

/**
 * Decir en voz alta en qué capítulo arranca la lectura.
 *
 * Escuchando con la pantalla apagada uno pierde la referencia de dónde está.
 * Esto lo dice, como hace un audiolibro.
 *
 * **Sólo suena ANTES de arrancar el audio, nunca lo interrumpe.** Esa es toda
 * la razón por la que esto es seguro: la parte de la voz es la que más bugs
 * tuvo, y meterse a pausar y retomar en el medio de un tramo es donde
 * aparecieron los de posición. Acá no hay nada sonando todavía.
 *
 * Por eso tampoco anuncia si retomás a mitad de capítulo: sólo cuando la
 * lectura empieza donde empieza el capítulo, o cuando saltaste a uno.
 */

/** Sintetiza y reproduce el anuncio. Nunca lanza: si falla, se lee igual. */
export async function speakAnnouncement(
  chapter: AnnounceableChapter,
  voiceId: string | null,
  language: string | null,
  rate: number,
): Promise<void> {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  try {
    const texto = buildAnnouncement(chapter);
    const uri = await synthesizeSpeech(`chapter--${chapter.orderIndex}--${texto.slice(0, 40)}`, texto, voiceId, language);
    player = createAudioPlayer({ uri });
    player.setPlaybackRate(rate);
    await new Promise<void>((resolve) => {
      let listo = false;
      const terminar = () => {
        if (listo) return;
        listo = true;
        clearTimeout(timeout);
        try { sub.remove(); } catch { /* ya removido */ }
        resolve();
      };
      // Tope de tiempo: un anuncio que no termina nunca no puede dejarte sin libro.
      const timeout = setTimeout(terminar, MAX_WAIT_MS);
      const sub = player!.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) terminar();
      });
      player!.play();
    });
  } catch {
    // Anunciar es un extra: si el motor de voz falla, la lectura sigue.
  } finally {
    try { player?.release(); } catch { /* ya liberado */ }
  }
}
