package expo.modules.voicesynthesizer

import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Sintetiza texto a un archivo WAV con el motor TTS del sistema (offline y gratis).
 *
 * La app reproduce ARCHIVOS (expo-audio): así conserva background, pantalla
 * bloqueada, seek y retroceso. Este módulo solo reemplaza al generador de audio.
 *
 * Sin latches: cada pedido guarda su Promise y se resuelve desde el callback del
 * motor, así ningún hilo queda bloqueado esperando la síntesis.
 */
private data class PendingSynthesis(
  val promise: Promise,
  val tempFile: File,
  val outputFile: File
)

private data class InitializationCallback(
  val onReady: (TextToSpeech) -> Unit,
  val onError: (String) -> Unit
)

class VoiceSynthesizerModule : Module() {
  private val stateLock = Any()
  private val pendingInitializations = mutableListOf<InitializationCallback>()
  private val pendingSyntheses = ConcurrentHashMap<String, PendingSynthesis>()

  private var textToSpeech: TextToSpeech? = null
  private var isInitializing = false

  override fun definition() = ModuleDefinition {
    Name("VoiceSynthesizer")

    OnDestroy {
      failAllPending("La sintesis se cancelo porque el modulo se cerro.")
      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
    }

    AsyncFunction("getVoicesAsync") { promise: Promise ->
      ensureEngine(
        onReady = { engine ->
          try {
            val voices = (engine.voices ?: emptySet<Voice>())
              .map { voice ->
                mapOf(
                  "identifier" to voice.name,
                  "name" to voice.name,
                  "language" to (voice.locale?.toLanguageTag() ?: ""),
                  "quality" to voice.quality,
                  "latency" to voice.latency,
                  "networkConnectionRequired" to voice.isNetworkConnectionRequired,
                  "notInstalled" to (voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true)
                )
              }
              .sortedBy { "${it["language"]}:${it["name"]}" }
            promise.resolve(voices)
          } catch (error: Exception) {
            promise.reject("ERR_VOICE_LIST", error.message ?: "No se pudieron listar las voces.", error)
          }
        },
        onError = { message -> promise.reject("ERR_VOICE_SYNTH_INIT", message, null) }
      )
    }

    AsyncFunction("getEngineInfoAsync") { promise: Promise ->
      ensureEngine(
        onReady = { engine ->
          promise.resolve(
            mapOf(
              "engine" to (engine.defaultEngine ?: ""),
              "maxInputLength" to TextToSpeech.getMaxSpeechInputLength()
            )
          )
        },
        onError = { message -> promise.reject("ERR_VOICE_SYNTH_INIT", message, null) }
      )
    }

    // voiceId: nombre exacto de una voz del motor. Si es null o ya no existe, se
    // usa `language` (BCP 47, p. ej. "es-US") y el motor elige su voz por defecto.
    AsyncFunction("synthesizeToFileAsync") { text: String, voiceId: String?, language: String?, outputPath: String, promise: Promise ->
      ensureEngine(
        onReady = { engine -> startSynthesis(engine, text, voiceId, language, outputPath, promise) },
        onError = { message -> promise.reject("ERR_VOICE_SYNTH_INIT", message, null) }
      )
    }

    // Corta la síntesis en curso y descarta la cola (cambio de libro, seek lejano).
    AsyncFunction("cancelAllAsync") {
      textToSpeech?.stop()
      failAllPending("Sintesis cancelada.")
    }
  }

  private fun startSynthesis(
    engine: TextToSpeech,
    text: String,
    voiceId: String?,
    language: String?,
    outputPath: String,
    promise: Promise
  ) {
    try {
      if (text.isBlank()) {
        promise.reject("ERR_EMPTY_TEXT", "No hay texto para sintetizar.", null)
        return
      }
      if (text.length > TextToSpeech.getMaxSpeechInputLength()) {
        promise.reject("ERR_TEXT_TOO_LONG", "El tramo supera el maximo que acepta el motor TTS.", null)
        return
      }

      val outputFile = resolveFile(outputPath)
      outputFile.parentFile?.mkdirs()
      // Se escribe a .tmp y se renombra al terminar: un WAV a medio escribir
      // nunca queda con el nombre que el cache de la app considera valido.
      val tempFile = File(outputFile.parentFile, "${outputFile.name}.tmp")
      if (tempFile.exists()) tempFile.delete()

      configureVoice(engine, voiceId, language)
      // Velocidad y tono neutros: la velocidad la maneja el reproductor, que
      // conserva el tono y permite cambiarla sin regenerar el audio.
      engine.setSpeechRate(1f)
      engine.setPitch(1f)

      val utteranceId = UUID.randomUUID().toString()
      pendingSyntheses[utteranceId] = PendingSynthesis(promise, tempFile, outputFile)

      val result = engine.synthesizeToFile(text, Bundle(), tempFile, utteranceId)
      if (result != TextToSpeech.SUCCESS) {
        pendingSyntheses.remove(utteranceId)
        promise.reject("ERR_SYNTHESIS_START", "El motor TTS rechazo el pedido de sintesis.", null)
      }
    } catch (error: Exception) {
      promise.reject("ERR_SYNTHESIS", error.message ?: "No se pudo sintetizar el audio.", error)
    }
  }

  private fun configureVoice(engine: TextToSpeech, voiceId: String?, language: String?) {
    if (!voiceId.isNullOrBlank()) {
      val selected = engine.voices?.firstOrNull { it.name == voiceId }
      if (selected != null) {
        engine.voice = selected
        return
      }
    }
    if (!language.isNullOrBlank()) {
      val locale = Locale.forLanguageTag(language)
      val availability = engine.isLanguageAvailable(locale)
      if (availability >= TextToSpeech.LANG_AVAILABLE) {
        engine.language = locale
      }
    }
  }

  private val progressListener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) = Unit

    override fun onDone(utteranceId: String) {
      val pending = pendingSyntheses.remove(utteranceId) ?: return
      try {
        if (!pending.tempFile.exists() || pending.tempFile.length() <= 44) {
          pending.tempFile.delete()
          pending.promise.reject("ERR_EMPTY_AUDIO", "El motor TTS no genero audio para este tramo.", null)
          return
        }
        if (pending.outputFile.exists()) pending.outputFile.delete()
        if (!pending.tempFile.renameTo(pending.outputFile)) {
          pending.tempFile.copyTo(pending.outputFile, overwrite = true)
          pending.tempFile.delete()
        }
        pending.promise.resolve(Uri.fromFile(pending.outputFile).toString())
      } catch (error: Exception) {
        pending.promise.reject("ERR_SYNTHESIS", error.message ?: "No se pudo guardar el audio.", error)
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String) {
      onError(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String, errorCode: Int) {
      val pending = pendingSyntheses.remove(utteranceId) ?: return
      pending.tempFile.delete()
      pending.promise.reject("ERR_SYNTHESIS", "El motor TTS fallo durante la sintesis (codigo $errorCode).", null)
    }

    override fun onStop(utteranceId: String, interrupted: Boolean) {
      val pending = pendingSyntheses.remove(utteranceId) ?: return
      pending.tempFile.delete()
      pending.promise.reject("ERR_SYNTHESIS_CANCELLED", "Sintesis cancelada.", null)
    }
  }

  private fun failAllPending(message: String) {
    val ids = pendingSyntheses.keys.toList()
    for (id in ids) {
      val pending = pendingSyntheses.remove(id) ?: continue
      pending.tempFile.delete()
      pending.promise.reject("ERR_SYNTHESIS_CANCELLED", message, null)
    }
  }

  private fun ensureEngine(onReady: (TextToSpeech) -> Unit, onError: (String) -> Unit) {
    val ready = synchronized(stateLock) { textToSpeech?.takeIf { !isInitializing } }
    if (ready != null) {
      onReady(ready)
      return
    }

    synchronized(stateLock) {
      pendingInitializations.add(InitializationCallback(onReady, onError))
      if (isInitializing) return
      isInitializing = true
    }

    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      finishInitialization(null, "No hay contexto Android activo para iniciar el sintetizador.")
      return
    }

    try {
      textToSpeech = TextToSpeech(context) { status ->
        val engine = textToSpeech
        if (status != TextToSpeech.SUCCESS || engine == null) {
          finishInitialization(null, "No se pudo iniciar el motor de voz de Android. Revisa que haya un motor TTS instalado.")
          return@TextToSpeech
        }
        engine.setOnUtteranceProgressListener(progressListener)
        finishInitialization(engine, null)
      }
    } catch (error: Exception) {
      finishInitialization(null, error.message ?: "No se pudo crear el motor de voz de Android.")
    }
  }

  // Un fallo de inicio NO queda cacheado: el proximo pedido reintenta (el
  // usuario pudo haber instalado un motor o datos de voz entre medio).
  private fun finishInitialization(engine: TextToSpeech?, errorMessage: String?) {
    val callbacks = synchronized(stateLock) {
      isInitializing = false
      if (engine == null) {
        textToSpeech?.shutdown()
        textToSpeech = null
      }
      pendingInitializations.toList().also { pendingInitializations.clear() }
    }
    for (callback in callbacks) {
      if (engine != null) callback.onReady(engine) else callback.onError(errorMessage ?: "Error de voz.")
    }
  }

  private fun resolveFile(path: String): File {
    val clean = if (path.startsWith("file://")) (Uri.parse(path).path ?: path.removePrefix("file://")) else path
    if (clean.isBlank()) throw IllegalArgumentException("Ruta de salida invalida.")
    return File(clean)
  }
}
