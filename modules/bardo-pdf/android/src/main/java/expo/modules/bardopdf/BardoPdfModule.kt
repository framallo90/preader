package expo.modules.bardopdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem
import com.tom_roush.pdfbox.text.PDFTextStripper
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
 *  - Texto: PDFBox abriendo el documento UNA vez, con memoria en archivo
 *    temporal. El extractor anterior recargaba el PDF entero en heap por cada
 *    pagina: de ahi venian la lentitud y el OOM con libros grandes.
 *
 * El trabajo pesado corre en hilos propios para no ocupar la cola compartida de
 * funciones async de Expo (SQLite y FileSystem viven ahi).
 */
private const val MAX_OUTLINE_ENTRIES = 600
private const val MAX_OUTLINE_LEVEL = 2

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

    OnCreate {
      try {
        PDFBoxResourceLoader.init(context.applicationContext)
      } catch (_: Exception) {
        // Si falla, extractPagesAsync lo reporta al usarse.
      }
    }

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
    // colorMode: "day" | "night" | "sepia".
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
              val scale = targetWidth / cropWidth
              val targetHeight = max((cropHeight * scale).roundToInt(), 1)

              val rendered = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
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
    AsyncFunction("detectContentBoxAsync") { uri: String, promise: Promise ->
      renderExecutor.execute {
        try {
          promise.resolve(detectContentBox(rendererFor(uri)))
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
        } catch (error: InvalidPasswordException) {
          promise.reject("ERR_PDF_PASSWORD", "El PDF esta protegido con contrasena.", error)
        } catch (error: OutOfMemoryError) {
          promise.reject("ERR_PDF_TOO_LARGE", "El PDF es demasiado grande para procesarlo en el telefono.", null)
        } catch (error: Exception) {
          promise.reject("ERR_PDF_EXTRACT", describe(error), error)
        }
      }
    }

    AsyncFunction("closeAsync") { promise: Promise ->
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
      renderer.openPage(index).use { page ->
        if (page.width > 0 && page.height > 0) aspects.add(page.width.toDouble() / page.height.toDouble())
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

  // ── Texto ─────────────────────────────────────────────────────────────────

  private fun extractPages(uri: String): Map<String, Any?> {
    // setTempDir devuelve el propio setting (estilo builder), por eso no se usa
    // como propiedad de Kotlin.
    val memory = MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)
    val document = if (uri.startsWith("content://")) {
      val stream = context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw IllegalArgumentException("No se pudo abrir el archivo: $uri")
      stream.use { PDDocument.load(it, memory) }
    } else {
      PDDocument.load(resolveFile(uri), memory)
    }

    document.use { doc ->
      val total = doc.numberOfPages
      val stripper = PDFTextStripper().apply { sortByPosition = true }
      val pages = ArrayList<String>(total)
      for (pageNumber in 1..total) {
        stripper.startPage = pageNumber
        stripper.endPage = pageNumber
        val text = try { stripper.getText(doc) } catch (_: Exception) { "" }
        pages.add(text)
        if (pageNumber % 20 == 0 || pageNumber == total) {
          sendEvent("extractProgress", mapOf("uri" to uri, "done" to pageNumber, "total" to total))
        }
      }
      val info = doc.documentInformation
      return mapOf(
        "pages" to pages,
        "outline" to readOutline(doc),
        "title" to info?.title?.trim()?.takeIf { it.isNotEmpty() },
        "author" to info?.author?.trim()?.takeIf { it.isNotEmpty() }
      )
    }
  }

  // Indice real del documento (marcadores del PDF). Un indice roto o ausente no
  // debe frenar la apertura: ante cualquier problema se devuelve lo leido hasta ahi.
  private fun readOutline(doc: PDDocument): List<Map<String, Any>> {
    val entries = ArrayList<Map<String, Any>>()
    try {
      val root = doc.documentCatalog?.documentOutline ?: return entries
      val pageIndexes = HashMap<Any, Int>()
      var index = 0
      for (page in doc.pages) {
        pageIndexes[page.cosObject] = index
        index += 1
      }

      fun walk(first: PDOutlineItem?, level: Int) {
        var item = first
        while (item != null && entries.size < MAX_OUTLINE_ENTRIES) {
          val title = item.title?.trim().orEmpty()
          val page = try { item.findDestinationPage(doc) } catch (_: Exception) { null }
          val pageIndex = if (page != null) pageIndexes[page.cosObject] else null
          if (title.isNotEmpty() && pageIndex != null) {
            entries.add(mapOf("title" to title, "pageIndex" to pageIndex, "level" to level))
          }
          if (level < MAX_OUTLINE_LEVEL) walk(item.firstChild, level + 1)
          item = item.nextSibling
        }
      }
      walk(root.firstChild, 0)
    } catch (_: Exception) {
      // indice ilegible: se usa lo que se haya podido leer
    }
    return entries
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
