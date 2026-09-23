package expo.modules.bardopdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfPage
import io.legere.pdfiumandroid.PdfTextPage
import io.legere.pdfiumandroid.PdfPasswordException
import io.legere.pdfiumandroid.PdfiumCore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PDF 100% en el telefono: reemplaza al backend (PyMuPDF).
 *
 *  - Render de paginas: PdfRenderer de Android (Pdfium), por pagina y a demanda.
 *  - Texto, indice y metadatos: Pdfium nativo (el motor de Chrome). PDFBox es
 *    Java puro: en un telefono tardaba minutos con un libro largo; Pdfium hace lo
 *    mismo en segundos y sin cargar el archivo en heap.
 *
 * El trabajo pesado corre en hilos propios para no ocupar la cola compartida de
 * funciones async de Expo (SQLite y FileSystem viven ahi).
 */
// Tope de cada lado del bitmap de una pagina. Un mapa o pergamino escaneado
// (proporcion 1:50) pedia 2048 x 102400 x 4 = ~838 MB y la pagina no se veia nunca.
private const val MAX_BITMAP_SIDE_PX = 8192
private const val MAX_OUTLINE_ENTRIES = 600
private const val MAX_OUTLINE_LEVEL = 2
/** Mas largo que esto ya no es una cita: se recorta al renglon tocado. */
private const val MAX_SENTENCE_CHARS = 600
private val LINE_FEED = 0x0A.toChar()
private val HYPHEN = 0x2D.toChar()

class BardoPdfModule : Module() {
  private val renderExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val extractExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  // Un PdfRenderer abierto por vez (el del libro en pantalla). Solo lo toca
  // renderExecutor, asi que no hace falta mas sincronizacion.
  private var openUri: String? = null
  private var openDescriptor: ParcelFileDescriptor? = null
  private var openRenderer: PdfRenderer? = null

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is null" }

  override fun definition() = ModuleDefinition {
    Name("BardoPdf")

    Events("extractProgress")

    OnDestroy {
      renderExecutor.execute { closeRenderer() }
      renderExecutor.shutdown()
      extractExecutor.shutdown()
    }

    AsyncFunction("getInfoAsync") { uri: String, promise: Promise ->
      renderExecutor.execute {
        try {
          val renderer = rendererFor(uri)
          promise.resolve(mapOf("pageCount" to renderer.pageCount, "pageAspect" to medianAspect(renderer)))
        } catch (error: Exception) {
          promise.reject("ERR_PDF_INFO", describe(error), error)
        }
      }
    }

    // crop: [left, top, right, bottom] como fraccion de la pagina (0..1), o null.
    // colorMode: "day" | "night" | "sepia" | "warm".
    AsyncFunction("renderPageAsync") { uri: String, pageIndex: Int, widthPx: Int, colorMode: String?, crop: List<Double>?, outputPath: String, promise: Promise ->
      renderExecutor.execute {
        try {
          val renderer = rendererFor(uri)
          if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
            throw IllegalArgumentException("Pagina $pageIndex fuera de rango (0-${renderer.pageCount - 1}).")
          }
          val outputFile = resolveFile(outputPath)
          outputFile.parentFile?.mkdirs()

          val targetWidth = min(max(widthPx, 64), 4096)
          val box = normalizeCrop(crop)

          var bitmap: Bitmap? = null
          try {
            renderer.openPage(pageIndex).use { page ->
              val pageWidth = page.width.toFloat()
              val pageHeight = page.height.toFloat()
              val cropWidth = (box[2] - box[0]) * pageWidth
              val cropHeight = (box[3] - box[1]) * pageHeight
              // Una pagina muy alargada (un mapa o un pergamino escaneado, 1:50)
              // pedia cientos de MB: el ancho estaba topeado pero el alto salia
              // del aspecto, sin limite. Se topea tambien el alto y, si hace
              // falta, se achica el ancho para conservar la proporcion.
              val rawScale = if (cropWidth > 0f) targetWidth / cropWidth else 1f
              val rawHeight = max((cropHeight * rawScale).roundToInt(), 1)
              val heightLimited = min(rawHeight, MAX_BITMAP_SIDE_PX)
              val scale = if (rawHeight > MAX_BITMAP_SIDE_PX && cropHeight > 0f) heightLimited / cropHeight else rawScale
              val finalWidth = max(min((cropWidth * scale).roundToInt(), targetWidth), 1)
              val targetHeight = heightLimited

              val rendered = Bitmap.createBitmap(finalWidth, targetHeight, Bitmap.Config.ARGB_8888)
              // PdfRenderer dibuja sobre transparente: sin fondo blanco el JPEG sale negro.
              rendered.eraseColor(Color.WHITE)
              val transform = Matrix().apply {
                postScale(scale, scale)
                postTranslate(-box[0] * pageWidth * scale, -box[1] * pageHeight * scale)
              }
              page.render(rendered, null, transform, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              bitmap = rendered
            }

            val finalBitmap = applyColorMode(bitmap!!, colorMode)
            if (finalBitmap !== bitmap) {
              bitmap?.recycle()
              bitmap = finalBitmap
            }

            val tempFile = File(outputFile.parentFile, "${outputFile.name}.tmp")
            FileOutputStream(tempFile).use { stream ->
              bitmap!!.compress(Bitmap.CompressFormat.JPEG, 88, stream)
            }
            if (outputFile.exists()) outputFile.delete()
            if (!tempFile.renameTo(outputFile)) {
              tempFile.copyTo(outputFile, overwrite = true)
              tempFile.delete()
            }
          } finally {
            bitmap?.recycle()
          }

          promise.resolve(Uri.fromFile(outputFile).toString())
        } catch (error: OutOfMemoryError) {
          promise.reject("ERR_PDF_RENDER_OOM", "No hay memoria para dibujar esta pagina.", null)
        } catch (error: Exception) {
          promise.reject("ERR_PDF_RENDER", describe(error), error)
        }
      }
    }

    // Caja de contenido comun a todo el libro (para recortar margenes blancos sin
    // que cada pagina quede de un alto distinto). Devuelve [l, t, r, b] en 0..1.
    // Corre en el hilo de extraccion, con un PdfRenderer propio: dibuja 12
    // Donde cae un texto dentro de una pagina, en coordenadas 0..1 (relativas al
    // tamano de la pagina, asi el lado JS las escala a lo que mida en pantalla).
    // `hint` es una pista de 0 a 1 de por donde esta: se elige la aparicion mas
    // cercana, porque una palabra puede repetirse en la misma pagina.
    AsyncFunction("pageTextRectsAsync") { uri: String, pageIndex: Int, needle: String, hint: Double, promise: Promise ->
      extractExecutor.execute {
        try {
          if (needle.isBlank()) {
            promise.resolve(emptyList<List<Double>>())
            return@execute
          }
          if (!ensureTextPage(uri, pageIndex)) {
            promise.resolve(emptyList<List<Double>>())
            return@execute
          }
          val textPage = textPageCache
          if (textPage == null) {
            promise.resolve(emptyList<List<Double>>())
            return@execute
          }
          val haystack = foldForMatch(textPageChars)
          val target = foldForMatch(needle)
          val near = (hint.coerceIn(0.0, 1.0) * haystack.length).toInt()
          val at = findNearest(haystack, target, near)
          if (at < 0) {
            promise.resolve(emptyList<List<Double>>())
            return@execute
          }

          val width = textPageSize.first
          val height = textPageSize.second
          if (width <= 0f || height <= 0f) {
            promise.resolve(emptyList<List<Double>>())
            return@execute
          }

          // Una caja por caracter, unidas por renglon: un texto que cruza de
          // renglon da dos rectangulos, no uno gigante en diagonal.
          val rects = ArrayList<List<Double>>()
          var left = Float.MAX_VALUE
          var right = -Float.MAX_VALUE
          var top = -Float.MAX_VALUE
          var bottom = Float.MAX_VALUE
          var lineTop = Float.NaN

          fun flush() {
            if (left <= right && bottom <= top) {
              rects.add(
                listOf(
                  (left / width).coerceIn(0f, 1f).toDouble(),
                  // Pdfium mide desde abajo; la pantalla, desde arriba.
                  ((height - top) / height).coerceIn(0f, 1f).toDouble(),
                  (right / width).coerceIn(0f, 1f).toDouble(),
                  ((height - bottom) / height).coerceIn(0f, 1f).toDouble()
                )
              )
            }
            left = Float.MAX_VALUE
            right = -Float.MAX_VALUE
            top = -Float.MAX_VALUE
            bottom = Float.MAX_VALUE
          }

          for (index in at until (at + target.length)) {
            val box = try { textPage.textPageGetCharBox(index) } catch (_: Throwable) { null } ?: continue
            // Renglon nuevo: el alto del caracter se corrio bastante.
            if (!lineTop.isNaN() && kotlin.math.abs(box.top - lineTop) > (box.top - box.bottom).coerceAtLeast(1f)) {
              flush()
            }
            lineTop = box.top
            if (box.left < left) left = box.left
            if (box.right > right) right = box.right
            if (box.top > top) top = box.top
            if (box.bottom < bottom) bottom = box.bottom
          }
          flush()
          promise.resolve(rects)
        } catch (error: Throwable) {
          promise.reject("ERR_PDF_RECTS", error.message ?: "No se pudo ubicar el texto en la pagina.", error)
        }
      }
    }

    // Que dice el PDF en el punto que tocaste. `x` e `y` van de 0 a 1 sobre la
    // pagina entera (el lado JS ya deshizo el recorte de margenes y el zoom).
    // Devuelve la ORACION completa que hay ahi, no la letra suelta: es lo que
    // uno quiere citar, y sin oracion aparece el renglon.
    AsyncFunction("textAtPointAsync") { uri: String, pageIndex: Int, x: Double, y: Double, promise: Promise ->
      extractExecutor.execute {
        try {
          if (!ensureTextPage(uri, pageIndex)) {
            promise.resolve(null)
            return@execute
          }
          val textPage = textPageCache
          val width = textPageSize.first
          val height = textPageSize.second
          if (textPage == null || width <= 0f || height <= 0f) {
            promise.resolve(null)
            return@execute
          }
          val px = (x.coerceIn(0.0, 1.0) * width).toFloat()
          // Pdfium mide desde abajo; el toque llega medido desde arriba.
          val py = ((1.0 - y.coerceIn(0.0, 1.0)) * height).toFloat()
          // Tolerancia generosa: un dedo no es un puntero, y entre renglones
          // no hay ningun caracter exactamente debajo.
          val tol = (height * 0.012f).coerceAtLeast(4f)
          val at = try {
            textPage.textPageGetCharIndexAtPos(px.toDouble(), py.toDouble(), tol.toDouble(), tol.toDouble())
          } catch (_: Throwable) { -1 }
          if (at < 0 || at >= textPageChars.length) {
            promise.resolve(null)
            return@execute
          }
          val (desde, hasta) = sentenceAround(textPageChars, at)
          val texto = textPageChars.substring(desde, hasta).trim()
          if (texto.isEmpty()) {
            promise.resolve(null)
            return@execute
          }
          promise.resolve(mapOf("text" to texto, "charInPage" to desde))
        } catch (error: Throwable) {
          promise.reject("ERR_PDF_POINT", error.message ?: "No se pudo leer el texto de ese punto.", error)
        }
      }
    }

    // muestras y si compartiera el hilo de render, las paginas que el usuario
    // esta mirando esperarian detras de ese trabajo de fondo.
    AsyncFunction("detectContentBoxAsync") { uri: String, promise: Promise ->
      extractExecutor.execute {
        try {
          val descriptor = openDescriptor(uri)
          try {
            PdfRenderer(descriptor).use { renderer -> promise.resolve(detectContentBox(renderer)) }
          } finally {
            try { descriptor.close() } catch (_: Exception) {}
          }
        } catch (error: Exception) {
          promise.reject("ERR_PDF_CROP", describe(error), error)
        }
      }
    }

    // Una entrada por pagina (aunque venga vacia): el indice del array ES el
    // numero de pagina, y eso permite el mapa exacto texto <-> pagina.
    AsyncFunction("extractPagesAsync") { uri: String, promise: Promise ->
      extractExecutor.execute {
        try {
          promise.resolve(extractPages(uri))
        } catch (error: PdfPasswordException) {
          promise.reject("ERR_PDF_PASSWORD", "El PDF esta protegido con contrasena.", error)
        } catch (error: OutOfMemoryError) {
          promise.reject("ERR_PDF_TOO_LARGE", "El PDF es demasiado grande para procesarlo en el telefono.", null)
        } catch (error: Exception) {
          promise.reject("ERR_PDF_EXTRACT", describe(error), error)
        }
      }
    }

    // El color que representa una tapa (para teñir "Seguir leyendo"). Se llama
    // una vez por tapa y el resultado se guarda: no hace falta que sea rapido,
    // pero es chico igual (la imagen se decodifica a ~48 px).
    AsyncFunction("coverColorAsync") { path: String, promise: Promise ->
      extractExecutor.execute {
        try {
          promise.resolve(coverColor(path))
        } catch (error: Exception) {
          promise.resolve(null)
        } catch (error: OutOfMemoryError) {
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("closeAsync") { promise: Promise ->
      // La pagina de texto abierta para los resaltados vive en el otro hilo.
      extractExecutor.execute { closeTextDocument() }
      renderExecutor.execute {
        closeRenderer()
        promise.resolve(null)
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private fun rendererFor(uri: String): PdfRenderer {
    val current = openRenderer
    if (current != null && openUri == uri) return current

    closeRenderer()
    val descriptor = openDescriptor(uri)
    try {
      val renderer = PdfRenderer(descriptor)
      openUri = uri
      openDescriptor = descriptor
      openRenderer = renderer
      return renderer
    } catch (error: Exception) {
      try { descriptor.close() } catch (_: Exception) {}
      throw error
    }
  }

  private fun closeRenderer() {
    try { openRenderer?.close() } catch (_: Exception) {}
    try { openDescriptor?.close() } catch (_: Exception) {}
    openRenderer = null
    openDescriptor = null
    openUri = null
  }

  private fun openDescriptor(uri: String): ParcelFileDescriptor {
    if (uri.startsWith("content://")) {
      return context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
        ?: throw IllegalArgumentException("No se pudo abrir el archivo: $uri")
    }
    return ParcelFileDescriptor.open(resolveFile(uri), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun normalizeCrop(crop: List<Double>?): FloatArray {
    val full = floatArrayOf(0f, 0f, 1f, 1f)
    if (crop == null || crop.size != 4) return full
    val left = crop[0].toFloat().coerceIn(0f, 0.45f)
    val top = crop[1].toFloat().coerceIn(0f, 0.45f)
    val right = crop[2].toFloat().coerceIn(0.55f, 1f)
    val bottom = crop[3].toFloat().coerceIn(0.55f, 1f)
    return floatArrayOf(left, top, right, bottom)
  }

  private fun applyColorMode(source: Bitmap, colorMode: String?): Bitmap {
    val matrix = when (colorMode) {
      // Noche: blanco -> #121212, negro -> #D8D8D8 (invertido y suavizado).
      "night" -> ColorMatrix(
        floatArrayOf(
          -0.776f, 0f, 0f, 0f, 216f,
          0f, -0.776f, 0f, 0f, 216f,
          0f, 0f, -0.776f, 0f, 216f,
          0f, 0f, 0f, 1f, 0f
        )
      )
      // Noche calida: blanco -> #1B1511, negro -> #DCBE96 (ambar, sin azul).
      "warm" -> ColorMatrix(
        floatArrayOf(
          -0.7569f, 0f, 0f, 0f, 220f,
          0f, -0.6627f, 0f, 0f, 190f,
          0f, 0f, -0.5216f, 0f, 150f,
          0f, 0f, 0f, 1f, 0f
        )
      )
      // Sepia: blanco -> #F4ECD8.
      "sepia" -> ColorMatrix(
        floatArrayOf(
          0.957f, 0f, 0f, 0f, 0f,
          0f, 0.925f, 0f, 0f, 0f,
          0f, 0f, 0.847f, 0f, 0f,
          0f, 0f, 0f, 1f, 0f
        )
      )
      else -> return source
    }
    val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    val paint = Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) }
    Canvas(output).drawBitmap(source, 0f, 0f, paint)
    return output
  }

  // La tapa de un libro escaneado suele tener otro tamano que las paginas de
  // adentro. Con la proporcion de la pagina 1 el resto quedaba con bandas a los
  // costados; la mediana de una muestra representa al libro.
  private fun medianAspect(renderer: PdfRenderer): Double? {
    val aspects = ArrayList<Double>()
    for (index in samplePageIndexes(renderer.pageCount, 9)) {
      // Una pagina rota no puede impedir ABRIR el libro: antes openPage tiraba
      // y se rechazaba getInfoAsync entero, asi que un PDF de 1000 paginas con
      // una sola dañada entre las 9 muestreadas no se abria. Se saltea, como ya
      // se hace al extraer texto.
      try {
        renderer.openPage(index).use { page ->
          if (page.width > 0 && page.height > 0) aspects.add(page.width.toDouble() / page.height.toDouble())
        }
      } catch (_: Exception) {
        continue
      }
    }
    if (aspects.isEmpty()) return null
    aspects.sort()
    return aspects[aspects.size / 2]
  }

  // Paginas repartidas por el libro, salteando tapa y portadilla.
  private fun samplePageIndexes(pageCount: Int, maxSamples: Int): List<Int> {
    if (pageCount <= 0) return emptyList()
    val first = if (pageCount > 6) 3 else 0
    val available = pageCount - first
    val count = min(maxSamples, available)
    val step = max(available / max(count, 1), 1)
    val indexes = ArrayList<Int>()
    var index = first
    while (index < pageCount && indexes.size < count) {
      indexes.add(index)
      index += step
    }
    return indexes
  }

  private fun detectContentBox(renderer: PdfRenderer): List<Double> {
    val pageCount = renderer.pageCount
    if (pageCount == 0) return listOf(0.0, 0.0, 1.0, 1.0)

    var left = 1.0
    var top = 1.0
    var right = 0.0
    var bottom = 0.0
    var found = false

    for (index in samplePageIndexes(pageCount, 12)) {
      val box = contentBoxOfPage(renderer, index)
      if (box != null) {
        left = min(left, box[0]); top = min(top, box[1])
        right = max(right, box[2]); bottom = max(bottom, box[3])
        found = true
      }
    }

    if (!found) return listOf(0.0, 0.0, 1.0, 1.0)

    // Un poco de aire: con el texto pegado al borde la pagina se ve apretada.
    val pad = 0.03
    val result = listOf(
      max(left - pad, 0.0), max(top - pad, 0.0),
      min(right + pad, 1.0), min(bottom + pad, 1.0)
    )
    // Si casi no hay margen que sacar, no vale la pena recortar.
    val gained = (result[0] + result[1] + (1 - result[2]) + (1 - result[3]))
    return if (gained < 0.06) listOf(0.0, 0.0, 1.0, 1.0) else result
  }

  // "Tinta" = bastante mas oscuro que el PAPEL de esa pagina, no que el blanco: en
  // un libro escaneado el papel es amarillento y contra un umbral fijo la pagina
  // entera contaba como contenido (no se recortaba nada). Una fila o columna cuenta
  // solo si tiene un minimo de tinta, para que motas sueltas no estiren la caja.
  private fun contentBoxOfPage(renderer: PdfRenderer, pageIndex: Int): DoubleArray? {
    val sampleWidth = 320
    var bitmap: Bitmap? = null
    try {
      renderer.openPage(pageIndex).use { page ->
        if (page.width <= 0 || page.height <= 0) return null
        val sampleHeight = max((sampleWidth.toFloat() * page.height / page.width).roundToInt(), 1)
        val rendered = Bitmap.createBitmap(sampleWidth, sampleHeight, Bitmap.Config.ARGB_8888)
        rendered.eraseColor(Color.WHITE)
        page.render(rendered, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        bitmap = rendered
      }
      val source = bitmap ?: return null
      val width = source.width
      val height = source.height
      val pixels = IntArray(width * height)
      source.getPixels(pixels, 0, width, 0, 0, width, height)

      val luminance = IntArray(pixels.size)
      val histogram = IntArray(256)
      for (i in pixels.indices) {
        val pixel = pixels[i]
        val value = (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) / 1000
        luminance[i] = value
        histogram[value] += 1
      }

      // Color del papel: la mediana (el papel ocupa casi toda la pagina).
      var seen = 0
      var paper = 255
      for (value in 0..255) {
        seen += histogram[value]
        if (seen >= pixels.size / 2) { paper = value; break }
      }
      val inkThreshold = (paper - 45).coerceIn(40, 225)

      val columnInk = IntArray(width)
      val rowInk = IntArray(height)
      for (y in 0 until height) {
        val row = y * width
        for (x in 0 until width) {
          if (luminance[row + x] < inkThreshold) {
            columnInk[x] += 1
            rowInk[y] += 1
          }
        }
      }

      val minColumnInk = max(2, height / 120)
      val minRowInk = max(2, width / 120)
      var minX = -1
      var maxX = -1
      for (x in 0 until width) if (columnInk[x] >= minColumnInk) { if (minX < 0) minX = x; maxX = x }
      var minY = -1
      var maxY = -1
      for (y in 0 until height) if (rowInk[y] >= minRowInk) { if (minY < 0) minY = y; maxY = y }
      if (minX < 0 || minY < 0) return null // pagina en blanco

      return doubleArrayOf(
        minX.toDouble() / width, minY.toDouble() / height,
        (maxX + 1).toDouble() / width, (maxY + 1).toDouble() / height
      )
    } finally {
      bitmap?.recycle()
    }
  }


  // ── Donde cae un texto dentro de la pagina ────────────────────────────────
  //
  // Para resaltar sobre la pagina lo que la voz esta leyendo hacen falta las
  // COORDENADAS de ese texto. Pdfium las tiene (es lo mismo que usa ReadEra):
  // textPageGetCharBox da la caja de cada caracter.
  //
  // El texto del libro que maneja la app esta unido y limpiado (encabezados
  // repetidos sacados, guiones de corte unidos), asi que una posicion global NO
  // corresponde uno a uno con el indice de caracter crudo de la pagina. Por eso
  // no se pasa una posicion: se pasa el TEXTO a buscar y una pista de donde
  // esta (0..1). Se busca la aparicion mas cercana a esa pista. Es robusto a las
  // diferencias de limpieza, que son de unos pocos renglones.

  /** Documento y pagina de texto abiertos, para no reabrir en cada palabra. */
  private var textDocUri: String? = null
  private var textDoc: PdfDocument? = null
  private var textDescriptor: ParcelFileDescriptor? = null
  private var textPageIndex: Int = -1
  // La pagina TIENE que quedar abierta mientras se use su capa de texto: la de
  // texto depende de ella. Cerrarla antes devolvia cero rectangulos, en silencio.
  private var textPageOwner: PdfPage? = null
  private var textPageCache: PdfTextPage? = null
  private var textPageChars: String = ""
  private var textPageSize: Pair<Float, Float> = Pair(0f, 0f)

  private fun closeTextPage() {
    try { textPageCache?.close() } catch (_: Throwable) {}
    try { textPageOwner?.close() } catch (_: Throwable) {}
    textPageCache = null
    textPageOwner = null
    textPageIndex = -1
    textPageChars = ""
  }

  private fun closeTextDocument() {
    closeTextPage()
    try { textDoc?.close() } catch (_: Throwable) {}
    try { textDescriptor?.close() } catch (_: Throwable) {}
    textDoc = null
    textDescriptor = null
    textDocUri = null
  }

  /** Deja abierta la pagina de texto pedida (reusa la anterior si es la misma). */
  private fun ensureTextPage(uri: String, pageIndex: Int): Boolean {
    if (textDocUri != uri) {
      closeTextDocument()
      val descriptor = openDescriptor(uri)
      textDoc = try {
        PdfiumCore(context.applicationContext).newDocument(descriptor)
      } catch (error: Throwable) {
        try { descriptor.close() } catch (_: Exception) {}
        throw error
      }
      textDescriptor = descriptor
      textDocUri = uri
    }
    if (textPageIndex == pageIndex && textPageCache != null) return true

    closeTextPage()
    val document = textDoc ?: return false
    return try {
      val page = document.openPage(pageIndex)
      val size = Pair(page.getPageWidthPoint().toFloat(), page.getPageHeightPoint().toFloat())
      val text = page.openTextPage()
      val count = text.textPageCountChars()
      textPageOwner = page
      textPageCache = text
      textPageIndex = pageIndex
      textPageChars = if (count > 0) (text.textPageGetText(0, count) ?: "") else ""
      textPageSize = size
      textPageChars.isNotEmpty()
    } catch (_: Throwable) {
      closeTextPage()
      false
    }
  }

  /** Compara sin tildes ni mayusculas: el texto del libro pasa por una limpieza. */
  /**
   * De donde a donde va la oracion que contiene a `at`.
   *
   * Corta en . ! ? y en renglon en blanco. Si la "oracion" sale larguisima (un
   * PDF sin puntuacion, una tabla) se recorta al renglon, que es mejor cita que
   * media pagina suelta.
   */
  private fun sentenceAround(texto: String, at: Int): Pair<Int, Int> {
    val salto = '\n'
    var desde = 0
    var i = at - 1
    while (i > 0) {
      val c = texto[i]
      if (esCierre(c) || (c == salto && texto[i - 1] == salto)) {
        desde = i + 1
        break
      }
      i--
    }
    var hasta = texto.length
    var j = at
    while (j < texto.length) {
      val c = texto[j]
      if (esCierre(c)) {
        hasta = j + 1
        break
      }
      if (c == salto && j + 1 < texto.length && texto[j + 1] == salto) {
        hasta = j
        break
      }
      j++
    }
    if (hasta - desde <= MAX_SENTENCE_CHARS) return Pair(desde, hasta)
    // Demasiado largo: queda el renglon del toque.
    val renglonDesde = (texto.lastIndexOf(salto, at - 1) + 1).coerceAtLeast(desde)
    val corte = texto.indexOf(salto, at)
    val renglonHasta = if (corte < 0) hasta else minOf(corte, hasta)
    return if (renglonHasta > renglonDesde) Pair(renglonDesde, renglonHasta) else Pair(desde, desde + MAX_SENTENCE_CHARS)
  }

  /** Donde termina una oracion: punto, exclamacion, pregunta o puntos suspensivos. */
  private fun esCierre(c: Char): Boolean = c == '.' || c == '!' || c == '?' || c == '…'

  private fun foldForMatch(value: String): String {
    val normalized = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
    val out = StringBuilder(normalized.length)
    for (ch in normalized) {
      if (ch.code in 0x300..0x36F) continue // marcas de acento
      out.append(ch.lowercaseChar())
    }
    return out.toString()
  }

  /** La aparicion de `needle` mas cercana a `near` (en caracteres), o -1. */
  private fun findNearest(haystack: String, needle: String, near: Int): Int {
    if (needle.isEmpty()) return -1
    var best = -1
    var bestDistance = Int.MAX_VALUE
    var at = haystack.indexOf(needle)
    while (at >= 0) {
      val distance = kotlin.math.abs(at - near)
      if (distance < bestDistance) {
        best = at
        bestDistance = distance
      }
      // Ya pasamos el punto buscado y nos estamos alejando: no hay nada mejor.
      if (at > near && best >= 0) break
      at = haystack.indexOf(needle, at + 1)
    }
    return best
  }

  // ── Texto ─────────────────────────────────────────────────────────────────

  private fun extractPages(uri: String): Map<String, Any?> {
    val descriptor = openDescriptor(uri)
    val document = try {
      PdfiumCore(context.applicationContext).newDocument(descriptor)
    } catch (error: Throwable) {
      try { descriptor.close() } catch (_: Exception) {}
      throw error
    }

    try {
      val total = document.getPageCount()
      val pages = ArrayList<String>(total)
      for (pageIndex in 0 until total) {
        pages.add(pageText(document, pageIndex))
        val done = pageIndex + 1
        if (done % 50 == 0 || done == total) {
          sendEvent("extractProgress", mapOf("uri" to uri, "done" to done, "total" to total))
        }
      }
      val meta = try { document.getDocumentMeta() } catch (_: Throwable) { null }
      return mapOf(
        "pages" to pages,
        "outline" to readOutline(document, total),
        "title" to meta?.title?.trim()?.takeIf { it.isNotEmpty() },
        "author" to meta?.author?.trim()?.takeIf { it.isNotEmpty() },
        // "Subject" es donde los editores ponen la sinopsis del libro.
        "subject" to meta?.subject?.trim()?.takeIf { it.isNotEmpty() }
      )
    } finally {
      try { document.close() } catch (_: Throwable) {}
      try { descriptor.close() } catch (_: Throwable) {}
    }
  }

  // Una pagina ilegible devuelve "" (no frena el libro). Pdfium marca el guion de
  // corte de renglon con U+0002 y separa renglones con CRLF: se normaliza a lo que
  // espera la limpieza de texto (guion + salto de renglon).
  private fun pageText(document: PdfDocument, pageIndex: Int): String {
    return try {
      document.openPage(pageIndex).use { page ->
        page.openTextPage().use { textPage ->
          val count = textPage.textPageCountChars()
          if (count <= 0) "" else sanitize(textPage.textPageGetText(0, count) ?: "")
        }
      }
    } catch (_: Throwable) {
      ""
    }
  }

  private fun sanitize(raw: String): String {
    val out = StringBuilder(raw.length)
    var index = 0
    while (index < raw.length) {
      val ch = raw[index]
      val code = ch.code
      when {
        code == 0x0D -> {
          out.append(LINE_FEED)
          if (index + 1 < raw.length && raw[index + 1].code == 0x0A) index += 1
        }
        code == 0x02 -> out.append(HYPHEN)
        code == 0xFFFE || code == 0xFFFF || code == 0x00 -> {}
        else -> out.append(ch)
      }
      index += 1
    }
    return out.toString()
  }

  // Indice real del documento (marcadores del PDF). Un indice roto o ausente no
  // debe frenar la apertura: ante cualquier problema se devuelve lo leido hasta ahi.
  private fun readOutline(document: PdfDocument, pageCount: Int): List<Map<String, Any>> {
    val entries = ArrayList<Map<String, Any>>()
    try {
      fun walk(items: List<PdfDocument.Bookmark>, level: Int) {
        for (item in items) {
          if (entries.size >= MAX_OUTLINE_ENTRIES) return
          val title = item.title?.trim().orEmpty()
          val pageIndex = item.pageIdx.toInt()
          if (title.isNotEmpty() && pageIndex in 0 until pageCount) {
            entries.add(mapOf("title" to title, "pageIndex" to pageIndex, "level" to level))
          }
          if (level < MAX_OUTLINE_LEVEL) walk(item.children, level + 1)
        }
      }
      walk(document.getTableOfContents(), 0)
    } catch (_: Throwable) {
      // indice ilegible: se usa lo que se haya podido leer
    }
    return entries
  }

  // ── Color de la tapa ──────────────────────────────────────────────────────

  // El tono que MANDA en la tapa, no el promedio: el promedio de una tapa
  // blanca con un dibujo rojo es un rosa gris que no se parece a nada. Se
  // reparten los pixeles en 12 tonos pesados por saturacion (el blanco, el
  // negro y los grises no votan) y se promedia el tono ganador. Si la tapa es
  // casi gris del todo, null: mejor sin tinte que con uno inventado.
  private fun coverColor(path: String): String? {
    val file = resolveFile(path)
    if (!file.exists()) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= 48) sample *= 2
    val bitmap = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    try {
      val w = bitmap.width
      val h = bitmap.height
      val pixels = IntArray(w * h)
      bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
      val peso = DoubleArray(12)
      val r = DoubleArray(12)
      val g = DoubleArray(12)
      val b = DoubleArray(12)
      val hsv = FloatArray(3)
      var total = 0.0
      for (p in pixels) {
        Color.colorToHSV(p, hsv)
        val s = hsv[1]
        val v = hsv[2]
        if (v < 0.12f || s < 0.18f) continue
        val bin = ((hsv[0] / 30f).toInt()).coerceIn(0, 11)
        val wgt = (s * v).toDouble()
        peso[bin] += wgt
        r[bin] += Color.red(p) * wgt
        g[bin] += Color.green(p) * wgt
        b[bin] += Color.blue(p) * wgt
        total += wgt
      }
      // Menos de un 4 % de la tapa con color de verdad: es una tapa gris.
      if (total < pixels.size * 0.04) return null
      var mejor = 0
      for (i in 1 until 12) if (peso[i] > peso[mejor]) mejor = i
      val cr = (r[mejor] / peso[mejor]).roundToInt().coerceIn(0, 255)
      val cg = (g[mejor] / peso[mejor]).roundToInt().coerceIn(0, 255)
      val cb = (b[mejor] / peso[mejor]).roundToInt().coerceIn(0, 255)
      return String.format("#%02X%02X%02X", cr, cg, cb)
    } finally {
      bitmap.recycle()
    }
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  private fun resolveFile(path: String): File {
    val clean = if (path.startsWith("file://")) (Uri.parse(path).path ?: path.removePrefix("file://")) else path
    if (clean.isBlank()) throw IllegalArgumentException("Ruta invalida.")
    return File(clean)
  }

  private fun describe(error: Exception): String {
    if (error is SecurityException) return "El PDF esta protegido con contrasena."
    return error.message ?: error.javaClass.simpleName
  }
}
