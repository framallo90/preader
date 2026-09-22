package expo.modules.bardoarchive

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import kotlin.math.max
import kotlin.math.roundToInt
import net.sf.sevenzipjbinding.ExtractAskMode
import net.sf.sevenzipjbinding.ExtractOperationResult
import net.sf.sevenzipjbinding.IArchiveExtractCallback
import net.sf.sevenzipjbinding.IInArchive
import net.sf.sevenzipjbinding.IInStream
import net.sf.sevenzipjbinding.ISeekableStream
import net.sf.sevenzipjbinding.ISequentialOutStream
import net.sf.sevenzipjbinding.PropID
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.SevenZipException

/**
 * Contenedores de archivos, en el telefono y por entrada a demanda:
 *
 *  - Comics: CBZ (zip), CBR (rar 4 y 5), CB7 (7z), CBT (tar). El formato se
 *    reconoce por el CONTENIDO, no por la extension (hay .cbr que son zip).
 *    Abrir = leer el indice del archivo; cada pagina se saca recien al mostrarse.
 *  - EPUB: lee los XHTML del zip sin pasar el libro entero por base64 a JS.
 *
 * ZIP en archivo local -> java.util.zip. Todo lo demas -> 7-Zip nativo.
 *
 * Tambien vive aca lo que la biblioteca necesita del sistema de archivos y que
 * en JavaScript era lento: listar carpetas SAF (una consulta por carpeta en vez
 * de dos o tres llamadas por archivo) y la huella de contenido de un libro.
 */
private const val FINGERPRINT_SAMPLE_BYTES = 256 * 1024
private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif")
private val PASSTHROUGH_MIME = setOf("image/jpeg", "image/png", "image/webp", "image/gif")
private const val MAX_TEXT_ENTRY_BYTES = 48L * 1024 * 1024
private const val ZIP_MAGIC_P: Byte = 0x50
private const val ZIP_MAGIC_K: Byte = 0x4B

private class Entry(val index: Int, val path: String, val size: Long)

private interface OpenedArchive : Closeable {
  val format: String
  /** Solido: las entradas se comprimen encadenadas y no se puede saltar a una sin descomprimir las anteriores. */
  val solid: Boolean
  val entries: List<Entry>
  fun read(entry: Entry, out: OutputStream)
}

private class ZipFileArchive(file: File) : OpenedArchive {
  private val zip = ZipFile(file)
  private val zipEntries = ArrayList<ZipEntry>()
  override val format = "zip"
  override val solid = false
  override val entries: List<Entry>

  init {
    // Recorrer las entradas puede fallar con nombres en codificaciones raras
    // (scans japoneses en Shift-JIS). Ese caso esta previsto —se reintenta con
    // 7-Zip— pero si el ZipFile no se cierra aca queda un descriptor abierto
    // por cada apertura, y escanear una biblioteca con varios de esos libros
    // agotaba los descriptores del proceso.
    try {
      val list = ArrayList<Entry>()
      for (entry in zip.entries()) {
        if (entry.isDirectory) continue
        list.add(Entry(zipEntries.size, entry.name.replace("\\", "/"), entry.size))
        zipEntries.add(entry)
      }
      entries = list
    } catch (error: Throwable) {
      runCatching { zip.close() }
      throw error
    }
  }

  override fun read(entry: Entry, out: OutputStream) {
    zip.getInputStream(zipEntries[entry.index]).use { it.copyTo(out, 64 * 1024) }
  }

  override fun close() = zip.close()
}

/** 7-Zip lee por un canal con seek: sirve igual para file:// y para content://. */
private class ChannelInStream(private val channel: FileChannel) : IInStream {
  override fun seek(offset: Long, seekOrigin: Int): Long {
    val base = when (seekOrigin) {
      ISeekableStream.SEEK_SET -> 0L
      ISeekableStream.SEEK_CUR -> channel.position()
      ISeekableStream.SEEK_END -> channel.size()
      else -> throw SevenZipException("Origen de seek invalido: $seekOrigin")
    }
    channel.position(base + offset)
    return channel.position()
  }

  override fun read(data: ByteArray): Int {
    if (data.isEmpty()) return 0
    val read = channel.read(ByteBuffer.wrap(data))
    return if (read < 0) 0 else read
  }

  override fun close() {}
}

private class SevenZipArchive(private val descriptor: ParcelFileDescriptor) : OpenedArchive {
  private val input = FileInputStream(descriptor.fileDescriptor)
  val archive: IInArchive = SevenZip.openInArchive(null, ChannelInStream(input.channel))
  override val format: String = archive.archiveFormat?.methodName?.lowercase() ?: "desconocido"
  override val solid: Boolean = (try { archive.getArchiveProperty(PropID.SOLID) } catch (_: Throwable) { null }) == true
  override val entries: List<Entry>

  init {
    val list = ArrayList<Entry>()
    for (index in 0 until archive.numberOfItems) {
      if (archive.getProperty(index, PropID.IS_FOLDER) == true) continue
      val path = (archive.getProperty(index, PropID.PATH) as? String)?.replace("\\", "/") ?: continue
      val size = (archive.getProperty(index, PropID.SIZE) as? Long) ?: 0L
      list.add(Entry(index, path, size))
    }
    entries = list
  }

  override fun read(entry: Entry, out: OutputStream) {
    val result = archive.extractSlow(entry.index, ISequentialOutStream { data ->
      out.write(data)
      data.size
    })
    if (result != ExtractOperationResult.OK) throw IOException(describeResult(result))
  }

  override fun close() {
    try { archive.close() } catch (_: Throwable) {}
    try { input.close() } catch (_: Throwable) {}
    try { descriptor.close() } catch (_: Throwable) {}
  }
}

private fun describeResult(result: ExtractOperationResult?): String = when (result) {
  ExtractOperationResult.WRONG_PASSWORD -> "El archivo esta protegido con contrasena."
  ExtractOperationResult.UNSUPPORTEDMETHOD -> "El archivo usa un metodo de compresion no soportado."
  ExtractOperationResult.CRCERROR, ExtractOperationResult.DATAERROR -> "El archivo esta danado."
  else -> "No se pudo leer el archivo (${result ?: "error"})."
}

/**
 * Archivo solido: se descomprime UNA vez, en orden, a una carpeta de cache. Las
 * paginas quedan disponibles a medida que salen (la primera, casi enseguida).
 */
private class SolidExtraction(val dir: File, private val archive: IInArchive, private val pages: List<Entry>) {
  private val lock = Object()
  private val ready = HashSet<Int>()
  private var finished = false
  private var failure: Throwable? = null
  /** Paginas que salieron dañadas: solo esas fallan, el resto del comic se lee. */
  private val failedPages = HashMap<Int, String>()
  @Volatile private var cancelled = false
  private var thread: Thread? = null

  fun start() {
    dir.mkdirs()
    if (File(dir, ".done").exists()) {
      // El marcador solo vale si los archivos siguen estando: Android puede
      // vaciar la cache a medias, y creerle dejaba paginas que no abrian nunca
      // (el marcador seguia ahi, asi que el problema era permanente).
      val present = (dir.list() ?: emptyArray()).toHashSet()
      if (pages.all { present.contains("${it.index}.bin") }) {
        synchronized(lock) {
          pages.forEach { ready.add(it.index) }
          finished = true
        }
        return
      }
      File(dir, ".done").delete()
    }
    val worker = Thread({ extractAll() }, "bardo-archive-solid")
    thread = worker
    worker.start()
  }

  private fun extractAll() {
    try {
      val indexes = pages.map { it.index }.sorted().toIntArray()
      archive.extract(indexes, false, object : IArchiveExtractCallback {
        private var currentIndex = -1
        private var currentStream: FileOutputStream? = null
        private var currentTemp: File? = null

        override fun getStream(index: Int, mode: ExtractAskMode): ISequentialOutStream? {
          if (cancelled) throw SevenZipException("cancelado")
          if (mode != ExtractAskMode.EXTRACT) return null
          val temp = File(dir, "$index.tmp")
          val stream = FileOutputStream(temp)
          currentIndex = index
          currentStream = stream
          currentTemp = temp
          return ISequentialOutStream { data ->
            if (cancelled) throw SevenZipException("cancelado")
            stream.write(data)
            data.size
          }
        }

        override fun prepareOperation(mode: ExtractAskMode) {}

        override fun setOperationResult(result: ExtractOperationResult) {
          val stream = currentStream ?: return
          val temp = currentTemp
          val index = currentIndex
          currentStream = null
          currentTemp = null
          try { stream.close() } catch (_: Throwable) {}
          if (result == ExtractOperationResult.OK && temp != null && temp.renameTo(File(dir, "$index.bin"))) {
            synchronized(lock) {
              ready.add(index)
              lock.notifyAll()
            }
          } else {
            temp?.delete()
            // Una pagina dañada NO frena el resto del comic: antes se lanzaba y
            // eso abortaba la descompresion entera, asi que todo lo que venia
            // despues de la pagina rota quedaba inaccesible. Se anota cual fallo
            // y se sigue; solo esa pagina va a dar error.
            if (result != ExtractOperationResult.OK) {
              synchronized(lock) {
                failedPages[index] = describeResult(result)
                lock.notifyAll()
              }
            }
          }
        }

        override fun setTotal(total: Long) {}

        override fun setCompleted(complete: Long) {
          if (cancelled) throw SevenZipException("cancelado")
        }
      })
      if (!cancelled) File(dir, ".done").createNewFile()
    } catch (error: Throwable) {
      if (!cancelled) synchronized(lock) { failure = error }
    } finally {
      synchronized(lock) {
        finished = true
        lock.notifyAll()
      }
    }
  }

  /** Espera a que la entrada este en disco; lanza si la descompresion fallo antes de llegar. */
  fun await(entry: Entry): File {
    synchronized(lock) {
      // Tambien sale por `cancelled`: esta espera puede durar minutos en un comic
      // solido grande, y mientras tanto era imposible cerrar el archivo (cerrar
      // se encolaba en la misma cola, detras de esta espera, asi que el libro
      // siguiente se quedaba cargando hasta que terminara el anterior).
      while (!ready.contains(entry.index) && !finished && !cancelled) lock.wait(400)
      if (!ready.contains(entry.index)) {
        if (cancelled) throw IOException("Se cerro el libro mientras se descomprimia.")
        throw IOException(failedPages[entry.index] ?: failure?.message ?: "No se pudo descomprimir la pagina.")
      }
    }
    return File(dir, "${entry.index}.bin")
  }

  /** Corta la descompresion. Se puede llamar desde cualquier hilo. */
  fun cancel() {
    cancelled = true
    synchronized(lock) { lock.notifyAll() }
  }

  /** Corta y espera. Devuelve false si el worker sigue vivo (no cerrar todavia). */
  fun cancelAndJoin(): Boolean {
    cancel()
    val worker = thread ?: return true
    try { worker.join(4000) } catch (_: InterruptedException) {}
    return !worker.isAlive
  }

  /** Espera al worker en segundo plano y recien entonces ejecuta `then`. */
  fun joinLater(then: () -> Unit) {
    val worker = thread
    if (worker == null || !worker.isAlive) { then(); return }
    Thread({
      try { worker.join() } catch (_: InterruptedException) {}
      then()
    }, "bardo-archive-close").start()
  }
}

private class EntryLookup(entries: List<Entry>) {
  private val exact = HashMap<String, Entry>()
  private val folded = HashMap<String, Entry>()

  init {
    for (entry in entries) {
      if (!exact.containsKey(entry.path)) exact[entry.path] = entry
      val key = entry.path.lowercase()
      if (!folded.containsKey(key)) folded[key] = entry
    }
  }

  fun find(path: String): Entry? {
    val clean = path.trimStart('/')
    exact[clean]?.let { return it }
    val decoded = try { Uri.decode(clean) } catch (_: Throwable) { clean }
    return exact[decoded] ?: folded[clean.lowercase()] ?: folded[decoded.lowercase()]
  }
}

class BardoArchiveModule : Module() {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  // Escaneo y huellas: no deben esperar detras de la descompresion de un comic.
  private val ioExecutor: ExecutorService = Executors.newFixedThreadPool(2)

  // Un archivo abierto por vez (el del libro en pantalla). Solo lo toca `executor`.
  private var openUri: String? = null
  private var opened: OpenedArchive? = null
  private var comicPages: List<Entry>? = null
  private var solidExtraction: SolidExtraction? = null

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is null" }

  override fun definition() = ModuleDefinition {
    Name("BardoArchive")

    OnDestroy {
      requestSolidCancel()
      executor.execute { closeArchive() }
      executor.shutdown()
      ioExecutor.shutdown()
    }

    // Comic: cantidad de paginas (imagenes en orden natural) y proporcion tipica.
    AsyncFunction("comicInfoAsync") { uri: String, promise: Promise ->
      submit(promise, "ERR_COMIC_INFO") {
        val archive = archiveFor(uri)
        val pages = pagesOf(archive)
        if (pages.isEmpty()) throw IOException("El archivo no contiene imagenes.")
        mapOf(
          "pageCount" to pages.size,
          "pageAspect" to medianAspect(archive, pages),
          "format" to archive.format,
          "solid" to archive.solid
        )
      }
    }

    // Deja la pagina como archivo de imagen en outputPath y devuelve su file://.
    AsyncFunction("renderComicPageAsync") { uri: String, pageIndex: Int, widthPx: Int, outputPath: String, promise: Promise ->
      submit(promise, "ERR_COMIC_RENDER") {
        val archive = archiveFor(uri)
        val pages = pagesOf(archive)
        if (pageIndex < 0 || pageIndex >= pages.size) {
          throw IllegalArgumentException("Pagina $pageIndex fuera de rango (0-${pages.size - 1}).")
        }
        val outputFile = resolveFile(outputPath)
        outputFile.parentFile?.mkdirs()
        writePageImage(entryBytes(archive, pages[pageIndex]), widthPx.coerceIn(64, 4096), outputFile)
        Uri.fromFile(outputFile).toString()
      }
    }

    // Texto de varias entradas (EPUB). null en las que no existen.
    AsyncFunction("readTextAsync") { uri: String, paths: List<String>, promise: Promise ->
      submit(promise, "ERR_ARCHIVE_READ") {
        val archive = archiveFor(uri)
        val lookup = EntryLookup(archive.entries)
        paths.map { path ->
          val entry = lookup.find(path)
          if (entry == null || entry.size > MAX_TEXT_ENTRY_BYTES) null else decodeText(entryBytes(archive, entry))
        }
      }
    }

    // Capitulos de un EPUB ya convertidos a texto plano normalizado, con la
    // posicion de cada ancla en ese texto (para ubicar el indice). null en las
    // entradas que no existen.
    AsyncFunction("readEpubTextsAsync") { uri: String, paths: List<String>, promise: Promise ->
      submit(promise, "ERR_ARCHIVE_READ") {
        val archive = archiveFor(uri)
        val lookup = EntryLookup(archive.entries)
        paths.map { path ->
          val entry = lookup.find(path)
          if (entry == null || entry.size > MAX_TEXT_ENTRY_BYTES) {
            null
          } else {
            val converted = HtmlText.convert(decodeText(entryBytes(archive, entry)))
            mapOf("text" to converted.text, "anchors" to converted.anchors)
          }
        }
      }
    }

    // Copia una entrada a un archivo (portada del EPUB). null si no existe.
    AsyncFunction("extractEntryAsync") { uri: String, path: String, outputPath: String, promise: Promise ->
      submit(promise, "ERR_ARCHIVE_EXTRACT") {
        val archive = archiveFor(uri)
        val entry = EntryLookup(archive.entries).find(path)
        if (entry == null) {
          null
        } else {
          val outputFile = resolveFile(outputPath)
          outputFile.parentFile?.mkdirs()
          val bytes = entryBytes(archive, entry)
          writeAtomically(outputFile) { stream -> stream.write(bytes) }
          Uri.fromFile(outputFile).toString()
        }
      }
    }

    AsyncFunction("closeAsync") { promise: Promise ->
      // Cancelar ANTES de encolar: si hay una descompresion larga en curso, el
      // cierre encolado esperaria detras de ella y el proximo libro no abriria.
      requestSolidCancel()
      executor.execute {
        closeArchive()
        promise.resolve(null)
      }
    }

    // Contenido de una carpeta SAF (arbol autorizado): nombre, tamano y tipo de
    // cada entrada en UNA consulta. Con expo-file-system eran readDirectory +
    // getInfo por entrada: cientos de idas y vueltas por carpeta.
    AsyncFunction("listDocumentTreeAsync") { treeUri: String, promise: Promise ->
      ioExecutor.execute {
        try {
          promise.resolve(listDocumentTree(Uri.parse(treeUri)))
        } catch (error: Throwable) {
          promise.reject("ERR_LIST_TREE", error.message ?: error.javaClass.simpleName, error)
        }
      }
    }

    // Huella de contenido del libro: SHA-256 de los primeros 256 KB (en base64)
    // + el tamano. Misma formula que la version en JavaScript, asi los libros ya
    // importados conservan su id (y con el, progreso, notas y colecciones).
    AsyncFunction("fingerprintAsync") { uri: String, size: Double, promise: Promise ->
      ioExecutor.execute {
        try {
          promise.resolve(fingerprint(uri, size.toLong()))
        } catch (error: Throwable) {
          promise.reject("ERR_FINGERPRINT", error.message ?: error.javaClass.simpleName, error)
        }
      }
    }
  }

  // ── Biblioteca ────────────────────────────────────────────────────────────

  private fun listDocumentTree(treeUri: Uri): List<Map<String, Any?>> {
    val documentId = if (DocumentsContract.isDocumentUri(context, treeUri)) {
      DocumentsContract.getDocumentId(treeUri)
    } else {
      DocumentsContract.getTreeDocumentId(treeUri)
    }
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE
    )
    val entries = ArrayList<Map<String, Any?>>()
    context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val childId = cursor.getString(0) ?: continue
        val mime = cursor.getString(2)
        entries.add(
          mapOf(
            "uri" to DocumentsContract.buildDocumentUriUsingTree(treeUri, childId).toString(),
            "name" to (cursor.getString(1) ?: ""),
            "isDirectory" to (mime == DocumentsContract.Document.MIME_TYPE_DIR),
            "size" to (if (cursor.isNull(3)) null else cursor.getLong(3).toDouble())
          )
        )
      }
    }
    return entries
  }

  private fun fingerprint(uri: String, size: Long): String {
    val head = ByteArray(FINGERPRINT_SAMPLE_BYTES)
    var read = 0
    openStream(uri).use { stream ->
      while (read < head.size) {
        val count = stream.read(head, read, head.size - read)
        if (count < 0) break
        read += count
      }
    }
    val sample = Base64.encodeToString(head, 0, read, Base64.NO_WRAP)
    val identity = "$sample:$size"
    val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
    val hex = StringBuilder(digest.size * 2)
    for (byte in digest) hex.append(String.format("%02x", byte))
    return "bk_" + hex.substring(0, 24)
  }

  private fun openStream(uri: String): java.io.InputStream {
    if (uri.startsWith("content://")) {
      return context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw IOException("No se pudo abrir el archivo: $uri")
    }
    return FileInputStream(resolveFile(uri))
  }

  private fun submit(promise: Promise, code: String, block: () -> Any?) {
    executor.execute {
      try {
        promise.resolve(block())
      } catch (error: OutOfMemoryError) {
        promise.reject("ERR_ARCHIVE_OOM", "No hay memoria para abrir esta pagina.", null)
      } catch (error: Throwable) {
        promise.reject(code, error.message ?: error.javaClass.simpleName, error)
      }
    }
  }

  // ── Apertura ──────────────────────────────────────────────────────────────

  private fun archiveFor(uri: String): OpenedArchive {
    val current = opened
    if (current != null && openUri == uri) return current

    closeArchive()
    val archive = openArchive(uri)
    openUri = uri
    opened = archive
    return archive
  }

  private fun openArchive(uri: String): OpenedArchive {
    if (!uri.startsWith("content://")) {
      val file = resolveFile(uri)
      if (!file.exists()) throw IOException("El archivo ya no existe.")
      if (looksLikeZip(file)) {
        // Un zip con nombres en una codificacion rara hace fallar a java.util.zip:
        // en ese caso lo abre 7-Zip.
        try {
          return ZipFileArchive(file)
        } catch (_: Exception) {
        }
      }
      return openWithSevenZip(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))
    }
    val descriptor = context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
      ?: throw IOException("No se pudo abrir el archivo: $uri")
    return openWithSevenZip(descriptor)
  }

  private fun openWithSevenZip(descriptor: ParcelFileDescriptor): OpenedArchive {
    try {
      return SevenZipArchive(descriptor)
    } catch (error: Throwable) {
      try { descriptor.close() } catch (_: Throwable) {}
      throw IOException("Formato de archivo no reconocido o danado.", error)
    }
  }

  private fun looksLikeZip(file: File): Boolean {
    val head = ByteArray(4)
    val read = FileInputStream(file).use { it.read(head) }
    if (read < 4 || head[0] != ZIP_MAGIC_P || head[1] != ZIP_MAGIC_K) return false
    val third = head[2].toInt()
    val fourth = head[3].toInt()
    return (third == 3 && fourth == 4) || (third == 5 && fourth == 6) || (third == 7 && fourth == 8)
  }

  private fun closeArchive() {
    val solid = solidExtraction
    val archive = opened
    solidExtraction = null
    opened = null
    openUri = null
    comicPages = null
    if (solid == null) {
      try { archive?.close() } catch (_: Throwable) {}
      return
    }
    // Cerrar el archivo nativo mientras el hilo de descompresion todavia lee de
    // el es un crash en 7-Zip. Si no termina a tiempo, se cierra despues, desde
    // un hilo aparte: lo que importa es que ESTA cola quede libre ya.
    if (solid.cancelAndJoin()) {
      try { archive?.close() } catch (_: Throwable) {}
    } else {
      solid.joinLater { try { archive?.close() } catch (_: Throwable) {} }
    }
  }

  /**
   * Corta la descompresion en curso SIN pasar por la cola: se llama desde el
   * hilo de la llamada para que una espera larga (`await`) se despierte y deje
   * la cola libre para el cierre que viene detras.
   */
  private fun requestSolidCancel() {
    solidExtraction?.cancel()
  }

  // ── Comics ────────────────────────────────────────────────────────────────

  private fun pagesOf(archive: OpenedArchive): List<Entry> {
    comicPages?.let { return it }
    val pages = archive.entries
      .filter { isComicImage(it.path) }
      .sortedWith { a, b -> naturalCompare(a.path, b.path) }
    comicPages = pages
    return pages
  }

  private fun isComicImage(path: String): Boolean {
    if (path.startsWith("__MACOSX/") || path.contains("/__MACOSX/")) return false
    val name = path.substringAfterLast("/")
    if (name.startsWith(".")) return false
    return name.substringAfterLast(".", "").lowercase() in IMAGE_EXTENSIONS
  }

  /** "pagina 2" antes que "pagina 10": los tramos de digitos se comparan como numeros. */
  private fun naturalCompare(left: String, right: String): Int {
    var i = 0
    var j = 0
    while (i < left.length && j < right.length) {
      val a = left[i]
      val b = right[j]
      if (a.isDigit() && b.isDigit()) {
        var endA = i
        while (endA < left.length && left[endA].isDigit()) endA += 1
        var endB = j
        while (endB < right.length && right[endB].isDigit()) endB += 1
        val numberA = left.substring(i, endA).trimStart('0')
        val numberB = right.substring(j, endB).trimStart('0')
        if (numberA.length != numberB.length) return numberA.length - numberB.length
        val byValue = numberA.compareTo(numberB)
        if (byValue != 0) return byValue
        i = endA
        j = endB
      } else {
        val byChar = a.lowercaseChar().compareTo(b.lowercaseChar())
        if (byChar != 0) return byChar
        i += 1
        j += 1
      }
    }
    return (left.length - i) - (right.length - j)
  }

  private fun entryBytes(archive: OpenedArchive, entry: Entry): ByteArray {
    if (archive.solid && archive is SevenZipArchive) {
      return solidFor(archive).await(entry).readBytes()
    }
    val initial = max(entry.size.coerceAtMost(64L * 1024 * 1024).toInt(), 32 * 1024)
    val buffer = ByteArrayOutputStream(initial)
    archive.read(entry, buffer)
    return buffer.toByteArray()
  }

  private fun solidFor(archive: SevenZipArchive): SolidExtraction {
    solidExtraction?.let { return it }
    val root = File(context.cacheDir, "bardo-archive")
    val key = Integer.toHexString((openUri ?: "").hashCode()) + "-" + archive.entries.size
    // Solo se conserva la descompresion del archivo abierto.
    root.listFiles()?.forEach { if (it.name != key) it.deleteRecursively() }
    val extraction = SolidExtraction(File(root, key), archive.archive, pagesOf(archive))
    extraction.start()
    solidExtraction = extraction
    return extraction
  }

  // La tapa y las portadillas suelen tener otra proporcion: se mide una muestra
  // repartida y se usa la mediana. En un archivo solido, solo las primeras paginas
  // (las demas todavia se estan descomprimiendo).
  private fun medianAspect(archive: OpenedArchive, pages: List<Entry>): Double? {
    val indexes = if (archive.solid) {
      (0 until pages.size).drop(if (pages.size > 3) 1 else 0).take(3)
    } else {
      val first = if (pages.size > 6) 2 else 0
      val available = pages.size - first
      val count = minOf(5, available)
      val step = max(available / max(count, 1), 1)
      (0 until count).map { first + it * step }.filter { it < pages.size }
    }
    val aspects = ArrayList<Double>()
    for (index in indexes) {
      try {
        val bytes = entryBytes(archive, pages[index])
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth > 0 && bounds.outHeight > 0) {
          aspects.add(bounds.outWidth.toDouble() / bounds.outHeight.toDouble())
        }
      } catch (_: Throwable) {
        // una pagina ilegible no define la proporcion del libro
      }
    }
    if (aspects.isEmpty()) return null
    aspects.sort()
    return aspects[aspects.size / 2]
  }

  // Si la imagen ya tiene un tamano razonable para la pantalla se guarda tal cual
  // (sin recomprimir: mas rapido y sin perdida). Un escaneo enorme se achica al
  // decodificar para no gastar memoria ni disco.
  private fun writePageImage(bytes: ByteArray, targetWidth: Int, outputFile: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IOException("La imagen de esta pagina no se pudo leer.")

    if (bounds.outWidth <= targetWidth * 1.25 && bounds.outMimeType in PASSTHROUGH_MIME) {
      writeAtomically(outputFile) { it.write(bytes) }
      return
    }

    var sample = 1
    while (bounds.outWidth / (sample * 2) >= targetWidth) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      ?: throw IOException("La imagen de esta pagina no se pudo leer.")
    try {
      if (bitmap.width > targetWidth) {
        val height = max((bitmap.height.toFloat() * targetWidth / bitmap.width).roundToInt(), 1)
        val scaled = Bitmap.createScaledBitmap(bitmap, targetWidth, height, true)
        if (scaled !== bitmap) {
          bitmap.recycle()
          bitmap = scaled
        }
      }
      if (bitmap.hasAlpha()) {
        // JPEG no tiene transparencia: sin fondo blanco sale negro.
        val flat = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(flat)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(bitmap, 0f, 0f, null)
        bitmap.recycle()
        bitmap = flat
      }
      val finalBitmap = bitmap
      writeAtomically(outputFile) { finalBitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    } finally {
      bitmap.recycle()
    }
  }

  // ── Texto ─────────────────────────────────────────────────────────────────

  private fun decodeText(bytes: ByteArray): String {
    if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) {
      return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
    }
    if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) return String(bytes, Charsets.UTF_16)
    if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) return String(bytes, Charsets.UTF_16)
    // <?xml version="1.0" encoding="ISO-8859-1"?>
    val head = String(bytes, 0, minOf(bytes.size, 200), Charsets.ISO_8859_1)
    val declared = Regex("encoding\\s*=\\s*[\"']([A-Za-z0-9._-]+)[\"']").find(head)?.groupValues?.get(1)
    val charset = try {
      if (declared != null && Charset.isSupported(declared)) Charset.forName(declared) else Charsets.UTF_8
    } catch (_: Throwable) {
      Charsets.UTF_8
    }
    return String(bytes, charset)
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  private fun writeAtomically(outputFile: File, write: (FileOutputStream) -> Unit) {
    val tempFile = File(outputFile.parentFile, "${outputFile.name}.tmp")
    FileOutputStream(tempFile).use { write(it) }
    if (outputFile.exists()) outputFile.delete()
    if (!tempFile.renameTo(outputFile)) {
      tempFile.copyTo(outputFile, overwrite = true)
      tempFile.delete()
    }
  }

  private fun resolveFile(path: String): File {
    val clean = if (path.startsWith("file://")) (Uri.parse(path).path ?: path.removePrefix("file://")) else path
    if (clean.isBlank()) throw IllegalArgumentException("Ruta invalida.")
    return File(clean)
  }
}
