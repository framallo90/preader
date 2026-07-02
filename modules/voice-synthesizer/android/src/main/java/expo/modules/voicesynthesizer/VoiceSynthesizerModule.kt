package expo.modules.voicesynthesizer

import android.media.AudioFormat
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

private const val BASE_DIRECTORY = "voice-synthesizer"
private const val WAVE_HEADER_SIZE = 44
private const val SYNTHESIS_TIMEOUT_SECONDS = 120L

private data class OutputAccumulator(
  val output: RandomAccessFile,
  val outputLock: Any = Any(),
  val totalDataSize: AtomicLong = AtomicLong(0),
  val expectedFormat: AtomicReference<WaveFormat?> = AtomicReference(null)
)

private data class PendingSynthesis(
  val latch: CountDownLatch = CountDownLatch(1),
  val errorMessage: AtomicReference<String?> = AtomicReference(null),
  val currentFormat: AtomicReference<WaveFormat?> = AtomicReference(null),
  val accumulator: OutputAccumulator
)

private data class InitializationCallback(
  val onReady: (TextToSpeech) -> Unit,
  val onError: (String) -> Unit
)

private data class WaveFormat(
  val channels: Short,
  val sampleRate: Int,
  val bitsPerSample: Short,
  val waveFormatCode: Short
)

class VoiceSynthesizerModule : Module() {
  private val stateLock = Any()
  private val pendingInitializations = mutableListOf<InitializationCallback>()
  private val pendingSyntheses = ConcurrentHashMap<String, PendingSynthesis>()

  private var textToSpeech: TextToSpeech? = null
  private var isInitializing = false
  private var initializationError: String? = null

  override fun definition() = ModuleDefinition {
    Name("VoiceSynthesizer")

    Events("synthesisProgress")

    OnDestroy {
      pendingSyntheses.forEach { (_, pending) ->
        pending.errorMessage.set("La sintesis se cancelo porque el modulo se cerro.")
        pending.latch.countDown()
      }
      pendingSyntheses.clear()

      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
    }

    AsyncFunction("getVoicesAsync") { promise: Promise ->
      ensureEngine(
        onReady = { engine ->
          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            promise.resolve(emptyList<Map<String, Any?>>())
            return@ensureEngine
          }

          val availableVoices = engine.voices
            ?.map { voice ->
              mapOf(
                "identifier" to voice.name,
                "name" to voice.name,
                "language" to voice.locale?.toLanguageTag().orEmpty(),
                "quality" to voice.quality,
                "latency" to voice.latency,
                "networkConnectionRequired" to voice.isNetworkConnectionRequired,
                "notInstalled" to false
              )
            }
            ?.sortedBy { "${it["language"]}:${it["name"]}" }
            ?: emptyList()

          promise.resolve(availableVoices)
        },
        onError = { message ->
          promise.reject("ERR_VOICE_SYNTH_INIT", message, null)
        }
      )
    }

    AsyncFunction("synthesizeDocumentAsync") { documentKey: String, cacheKey: String, segments: List<String>, voiceId: String?, promise: Promise ->
      ensureEngine(
        onReady = { engine ->
          try {
            if (segments.isEmpty()) {
              promise.reject("ERR_EMPTY_DOCUMENT_AUDIO", "No hay texto para sintetizar.", null)
              return@ensureEngine
            }

            val outputDirectory = resolveOutputDirectory(documentKey, cacheKey)
            if (!outputDirectory.exists()) {
              outputDirectory.mkdirs()
            }

            val outputFile = File(outputDirectory, "document-audio.wav")

            if (outputFile.exists() && outputFile.length() > WAVE_HEADER_SIZE) {
              promise.resolve(
                mapOf(
                  "fileUri" to Uri.fromFile(outputFile).toString(),
                  "cacheKey" to cacheKey,
                  "documentKey" to documentKey,
                  "segmentCount" to segments.size
                )
              )
              return@ensureEngine
            }

            configureVoice(engine, voiceId)
            engine.setSpeechRate(1f)

            RandomAccessFile(outputFile, "rw").use { output ->
              output.setLength(0)
              output.write(ByteArray(WAVE_HEADER_SIZE))

              val accumulator = OutputAccumulator(output)

              segments.forEachIndexed { index, text ->
                val tempFile = File(outputDirectory, "segment-${index.toString().padStart(4, '0')}.tmp")
                synthesizeSegment(engine, text, tempFile, accumulator)
                if (tempFile.exists()) {
                  tempFile.delete()
                }

                sendEvent(
                  "synthesisProgress",
                  mapOf(
                    "documentKey" to documentKey,
                    "cacheKey" to cacheKey,
                    "completedSegments" to index + 1,
                    "totalSegments" to segments.size
                  )
                )
              }

              val waveFormat = accumulator.expectedFormat.get()
                ?: throw IllegalStateException("El motor TTS no entrego formato de audio utilizable.")
              output.seek(0)
              output.write(buildWaveHeader(waveFormat, accumulator.totalDataSize.get()))
            }

            promise.resolve(
              mapOf(
                "fileUri" to Uri.fromFile(outputFile).toString(),
                "cacheKey" to cacheKey,
                "documentKey" to documentKey,
                "segmentCount" to segments.size
              )
            )
          } catch (error: Exception) {
            promise.reject(
              "ERR_DOCUMENT_SYNTHESIS",
              error.message ?: "No se pudo generar el audio del documento.",
              error
            )
          }
        },
        onError = { message ->
          promise.reject("ERR_VOICE_SYNTH_INIT", message, null)
        }
      )
    }

    AsyncFunction("clearDocumentAudioAsync") { documentKey: String, cacheKey: String ->
      val outputDirectory = resolveOutputDirectory(documentKey, cacheKey)
      if (outputDirectory.exists()) {
        outputDirectory.deleteRecursively()
      }
    }

    AsyncFunction("clearAllDocumentAudioAsync") { documentKeyRoot: String ->
      val cacheRoot = appContext.reactContext?.cacheDir
        ?: throw IllegalStateException("No se pudo acceder al cache local de audio.")
      val baseDirectory = File(cacheRoot, BASE_DIRECTORY)

      if (!baseDirectory.exists()) {
        return@AsyncFunction
      }

      val sanitizedRoot = sanitizeKey(documentKeyRoot)

      baseDirectory.listFiles()?.forEach { cacheKeyDirectory ->
        if (!cacheKeyDirectory.isDirectory) {
          return@forEach
        }

        cacheKeyDirectory.listFiles()?.forEach { documentDirectory ->
          if (!documentDirectory.isDirectory) {
            return@forEach
          }

          val matchesDocument = documentDirectory.name == sanitizedRoot
          val matchesChunk = documentDirectory.name.startsWith("${sanitizedRoot}--chunk-")

          if (matchesDocument || matchesChunk) {
            documentDirectory.deleteRecursively()
          }
        }

        if (cacheKeyDirectory.listFiles().isNullOrEmpty()) {
          cacheKeyDirectory.delete()
        }
      }
    }

    AsyncFunction("clearAudioFileAsync") { fileUri: String ->
      val file = resolveFileFromUri(fileUri)
      if (file.exists()) {
        file.delete()
      }
    }
  }

  private fun ensureEngine(
    onReady: (TextToSpeech) -> Unit,
    onError: (String) -> Unit
  ) {
    val existingEngine = synchronized(stateLock) {
      textToSpeech?.takeIf { !isInitializing && initializationError == null }
    }

    if (existingEngine != null) {
      onReady(existingEngine)
      return
    }

    val existingError = synchronized(stateLock) { initializationError }
    if (existingError != null) {
      onError(existingError)
      return
    }

    synchronized(stateLock) {
      pendingInitializations.add(InitializationCallback(onReady, onError))

      if (isInitializing) {
        return
      }

      isInitializing = true
    }

    val reactContext = appContext.reactContext
    if (reactContext == null) {
      finishInitializationWithError("No hay contexto Android activo para iniciar el sintetizador.")
      return
    }

    try {
      textToSpeech = TextToSpeech(reactContext.applicationContext) { status ->
        val engine = textToSpeech

        if (status != TextToSpeech.SUCCESS || engine == null) {
          finishInitializationWithError("No se pudo iniciar el motor TTS de Android.")
          return@TextToSpeech
        }

        engine.setOnUtteranceProgressListener(progressListener)
        finishInitializationWithSuccess(engine)
      }
    } catch (error: Exception) {
      finishInitializationWithError(
        error.message ?: "No se pudo crear el motor TTS de Android."
      )
    }
  }

  private fun finishInitializationWithSuccess(engine: TextToSpeech) {
    val callbacks = synchronized(stateLock) {
      isInitializing = false
      initializationError = null
      pendingInitializations.toList().also { pendingInitializations.clear() }
    }

    callbacks.forEach { callback ->
      callback.onReady(engine)
    }
  }

  private fun finishInitializationWithError(message: String) {
    textToSpeech?.shutdown()
    textToSpeech = null

    val callbacks = synchronized(stateLock) {
      isInitializing = false
      initializationError = message
      pendingInitializations.toList().also { pendingInitializations.clear() }
    }

    callbacks.forEach { callback ->
      callback.onError(message)
    }
  }

  private val progressListener = object : UtteranceProgressListener() {
    override fun onBeginSynthesis(
      utteranceId: String,
      sampleRateInHz: Int,
      audioFormat: Int,
      channelCount: Int
    ) {
      pendingSyntheses[utteranceId]?.let { pending ->
        val waveFormat = mapWaveFormat(sampleRateInHz, audioFormat, channelCount)

        if (waveFormat == null) {
          pending.errorMessage.set("El motor TTS devolvio un formato de audio no compatible.")
          return@let
        }

        pending.currentFormat.set(waveFormat)

        val expectedFormat = pending.accumulator.expectedFormat.get()
        if (expectedFormat == null) {
          pending.accumulator.expectedFormat.compareAndSet(null, waveFormat)
          return@let
        }

        if (expectedFormat != waveFormat) {
          pending.errorMessage.set("La voz cambio el formato del audio entre segmentos y no se puede unir de forma segura.")
        }
      }
    }

    override fun onAudioAvailable(utteranceId: String, audio: ByteArray) {
      pendingSyntheses[utteranceId]?.let { pending ->
        if (pending.errorMessage.get() != null || audio.isEmpty()) {
          return@let
        }

        synchronized(pending.accumulator.outputLock) {
          pending.accumulator.output.write(audio)
          pending.accumulator.totalDataSize.addAndGet(audio.size.toLong())
        }
      }
    }

    override fun onStart(utteranceId: String) = Unit

    override fun onDone(utteranceId: String) {
      pendingSyntheses.remove(utteranceId)?.latch?.countDown()
    }

    override fun onError(utteranceId: String) {
      onError(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String, errorCode: Int) {
      pendingSyntheses.remove(utteranceId)?.let { pending ->
        pending.errorMessage.set("El motor TTS fallo durante la sintesis (codigo $errorCode).")
        pending.latch.countDown()
      }
    }

    override fun onStop(utteranceId: String, interrupted: Boolean) {
      pendingSyntheses.remove(utteranceId)?.let { pending ->
        pending.errorMessage.set(
          if (interrupted) {
            "La sintesis fue interrumpida antes de completarse."
          } else {
            "La sintesis se detuvo antes de completarse."
          }
        )
        pending.latch.countDown()
      }
    }
  }

  private fun configureVoice(engine: TextToSpeech, voiceId: String?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP || voiceId.isNullOrBlank()) {
      return
    }

    val selectedVoice = engine.voices?.firstOrNull { voice -> voice.name == voiceId }

    if (selectedVoice != null) {
      engine.voice = selectedVoice
    }
  }

  private fun mapWaveFormat(sampleRateInHz: Int, audioFormat: Int, channelCount: Int): WaveFormat? {
    val bitsPerSample = when (audioFormat) {
      AudioFormat.ENCODING_PCM_8BIT -> 8.toShort()
      AudioFormat.ENCODING_PCM_16BIT -> 16.toShort()
      AudioFormat.ENCODING_PCM_FLOAT -> 32.toShort()
      else -> return null
    }

    val waveFormatCode = when (audioFormat) {
      AudioFormat.ENCODING_PCM_FLOAT -> 3.toShort()
      else -> 1.toShort()
    }

    return WaveFormat(
      channels = channelCount.toShort(),
      sampleRate = sampleRateInHz,
      bitsPerSample = bitsPerSample,
      waveFormatCode = waveFormatCode
    )
  }

  private fun synthesizeSegment(
    engine: TextToSpeech,
    text: String,
    outputFile: File,
    accumulator: OutputAccumulator
  ) {
    if (text.isBlank()) {
      throw IllegalArgumentException("Uno de los segmentos de audio esta vacio.")
    }

    outputFile.parentFile?.mkdirs()
    if (outputFile.exists()) {
      outputFile.delete()
    }

    val utteranceId = UUID.randomUUID().toString()
    val pending = PendingSynthesis(accumulator = accumulator)
    pendingSyntheses[utteranceId] = pending

    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      val params = Bundle().apply {
        putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
      }
      engine.synthesizeToFile(text, params, outputFile, utteranceId)
    } else {
      TextToSpeech.ERROR
    }

    if (result != TextToSpeech.SUCCESS) {
      pendingSyntheses.remove(utteranceId)
      throw IllegalStateException("No se pudo iniciar la sintesis de uno de los segmentos del documento.")
    }

    val completed = pending.latch.await(SYNTHESIS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    val synthesisError = pending.errorMessage.get()

    if (!completed) {
      pendingSyntheses.remove(utteranceId)
      throw IllegalStateException("La sintesis de audio tardo demasiado y se cancelo.")
    }

    if (synthesisError != null) {
      pendingSyntheses.remove(utteranceId)
      throw IllegalStateException(synthesisError)
    }

    if (pending.currentFormat.get() == null) {
      pendingSyntheses.remove(utteranceId)
      throw IllegalStateException("El motor TTS no informo el formato del audio sintetizado.")
    }
  }

  private fun buildWaveHeader(format: WaveFormat, dataSize: Long): ByteArray {
    val byteRate = format.sampleRate * format.channels * format.bitsPerSample / 8
    val blockAlign = (format.channels * format.bitsPerSample / 8).toShort()
    val totalSize = dataSize + 36
    val buffer = ByteBuffer.allocate(WAVE_HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)

    buffer.put("RIFF".toByteArray(Charsets.US_ASCII))
    buffer.putInt(totalSize.toInt())
    buffer.put("WAVE".toByteArray(Charsets.US_ASCII))
    buffer.put("fmt ".toByteArray(Charsets.US_ASCII))
    buffer.putInt(16)
    buffer.putShort(format.waveFormatCode)
    buffer.putShort(format.channels)
    buffer.putInt(format.sampleRate)
    buffer.putInt(byteRate)
    buffer.putShort(blockAlign)
    buffer.putShort(format.bitsPerSample)
    buffer.put("data".toByteArray(Charsets.US_ASCII))
    buffer.putInt(dataSize.toInt())

    return buffer.array()
  }

  private fun resolveOutputDirectory(documentKey: String, cacheKey: String): File {
    val cacheRoot = appContext.reactContext?.cacheDir
      ?: throw IllegalStateException("No se pudo acceder al cache local para la sintesis.")

    return File(
      File(File(cacheRoot, BASE_DIRECTORY), sanitizeKey(cacheKey)),
      sanitizeKey(documentKey)
    )
  }

  private fun resolveFileFromUri(fileUri: String): File {
    val parsed = Uri.parse(fileUri)
    val path = parsed.path ?: fileUri.removePrefix("file://")

    if (path.isBlank()) {
      throw IllegalArgumentException("La ruta del archivo de audio es invalida.")
    }

    return File(path)
  }

  private fun sanitizeKey(value: String): String {
    val sanitized = value
      .lowercase(Locale.US)
      .replace("[^a-z0-9._-]".toRegex(), "-")
      .replace("-{2,}".toRegex(), "-")
      .trim('-')

    return if (sanitized.isBlank()) "default" else sanitized
  }
}
