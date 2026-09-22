package expo.modules.bardoarchive

/**
 * XHTML de un capitulo de EPUB -> texto plano normalizado, en UNA pasada, con la
 * posicion (en el texto resultante) de cada ancla (id / name).
 *
 * Es la version nativa de htmlToText + normalizeExtractedText de src/utils: en
 * JavaScript eran 17 pasadas de expresiones regulares sobre cada archivo y, en el
 * telefono, mas de medio segundo por libro antes de mostrar la primera linea. Las
 * reglas son las mismas:
 *
 *  - Solo cuenta el <body> (o todo menos <head> si no hay body).
 *  - <script> y <style> se descartan enteros. <br> es un salto de renglon;
 *    cerrar p/h1-h6/li/blockquote/tr es un salto de parrafo; cerrar div, un renglon.
 *  - Entidades con nombre y numericas.
 *  - Normalizacion: CRLF -> LF, "pala-\nbra" se une, sin NUL, NBSP -> espacio,
 *    sin espacios al final del renglon, no mas de un renglon en blanco seguido,
 *    espacios repetidos a uno, y sin espacios en las puntas.
 *
 * Todo trabaja sobre indices del String original: sin substring por etiqueta ni
 * busquedas "ignoreCase" genericas (las dos cosas multiplicaban por diez el costo).
 */
class HtmlTextResult(val text: String, val anchors: Map<String, Int>)

object HtmlText {
  private val NAMED_ENTITIES = mapOf(
    "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ",
    "mdash" to "—", "ndash" to "–", "hellip" to "…", "laquo" to "«", "raquo" to "»",
    "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”", "iexcl" to "¡", "iquest" to "¿",
    "aacute" to "á", "eacute" to "é", "iacute" to "í", "oacute" to "ó", "uacute" to "ú", "ntilde" to "ñ", "uuml" to "ü",
    "Aacute" to "Á", "Eacute" to "É", "Iacute" to "Í", "Oacute" to "Ó", "Uacute" to "Ú", "Ntilde" to "Ñ", "Uuml" to "Ü"
  )
  private const val MAX_ENTITY_LENGTH = 12

  fun convert(html: String): HtmlTextResult {
    val raw = StringBuilder(html.length / 2 + 16)
    val rawAnchors = LinkedHashMap<String, Int>()

    // Donde empieza y termina el contenido.
    var start = 0
    var end = html.length
    val bodyOpen = findOpeningTag(html, "body", 0)
    if (bodyOpen >= 0) {
      start = html.indexOf('>', bodyOpen).let { if (it < 0) html.length else it + 1 }
    } else {
      val headOpen = findOpeningTag(html, "head", 0)
      if (headOpen >= 0) {
        val headClose = findClosingTag(html, "head", headOpen)
        if (headClose >= 0) {
          start = html.indexOf('>', headClose).let { if (it < 0) html.length else it + 1 }
        }
      }
    }
    val bodyClose = findClosingTag(html, "body", start)
    if (bodyClose >= 0) end = bodyClose

    var i = start
    while (i < end) {
      val ch = html[i]
      if (ch == '<') {
        val close = html.indexOf('>', i + 1)
        if (close < 0 || close >= end) break
        val next = i + 1
        if (html.startsWith("!--", next)) { i = close + 1; continue }
        val isClosing = html[next] == '/'
        val nameStart = if (isClosing) next + 1 else next
        var nameEnd = nameStart
        while (nameEnd < close && html[nameEnd].isLetterOrDigit()) nameEnd += 1
        val nameLength = nameEnd - nameStart

        if (!isClosing) {
          if (nameIs(html, nameStart, nameLength, "script") || nameIs(html, nameStart, nameLength, "style")) {
            val stop = findClosingTag(html, html.substring(nameStart, nameEnd).lowercase(), close + 1)
            i = if (stop < 0) end else html.indexOf('>', stop).let { if (it < 0) end else it + 1 }
            continue
          }
          val id = anchorAttribute(html, nameEnd, close)
          if (id != null && !rawAnchors.containsKey(id)) rawAnchors[id] = raw.length
          if (nameIs(html, nameStart, nameLength, "br")) raw.append('\n')
        } else if (isParagraphCloser(html, nameStart, nameLength)) {
          raw.append("\n\n")
        } else if (nameIs(html, nameStart, nameLength, "div")) {
          raw.append('\n')
        }
        i = close + 1
        continue
      }
      if (ch == '&') {
        val semi = indexOfSemicolon(html, i + 1, minOf(end, i + 1 + MAX_ENTITY_LENGTH))
        if (semi > i + 1) {
          val decoded = decodeEntity(html, i + 1, semi)
          if (decoded != null) {
            raw.append(decoded)
            i = semi + 1
            continue
          }
        }
      }
      raw.append(ch)
      i += 1
    }

    return normalize(raw, rawAnchors)
  }

  // ── Normalizacion con seguimiento de anclas ──────────────────────────────

  private fun normalize(raw: StringBuilder, rawAnchors: Map<String, Int>): HtmlTextResult {
    // Anclas ordenadas por posicion: se traducen a medida que se emite el texto.
    val pending = rawAnchors.entries.sortedBy { it.value }
    var nextAnchor = 0
    val anchors = HashMap<String, Int>()
    val out = StringBuilder(raw.length)

    var spaces = 0 // espacios/tabs acumulados (se emiten como uno solo, o nada antes de un salto)
    var newlines = 0 // saltos acumulados (maximo dos seguidos)
    val length = raw.length
    var i = 0
    while (i < length) {
      while (nextAnchor < pending.size && pending[nextAnchor].value <= i) {
        // El ancla apunta a donde va a quedar el proximo contenido (despues de
        // los saltos y el espacio que todavia estan pendientes de emitirse).
        anchors[pending[nextAnchor].key] = out.length + pendingLength(out, newlines, spaces)
        nextAnchor += 1
      }
      var c = raw[i]
      if (c == '\r') {
        if (i + 1 < length && raw[i + 1] == '\n') i += 1
        c = '\n'
      }
      if (c == '\u0000') { i += 1; continue }
      if (c == ' ') c = ' '

      when {
        c == '\n' -> {
          // "pala-\nbra": se une (letra, guion, salto, letra minuscula o mayuscula).
          if (spaces == 0 && newlines == 0 && out.length >= 2 && out[out.length - 1] == '-' &&
            isWordLetter(out[out.length - 2]) && i + 1 < length && isWordLetter(raw[i + 1])
          ) {
            out.setLength(out.length - 1)
            i += 1
            continue
          }
          spaces = 0 // espacios al final del renglon: fuera
          newlines += 1
        }
        c == ' ' || c == '\t' -> spaces += 1
        else -> {
          if (out.isNotEmpty()) {
            // Como en la version JS: los saltos se reducen a dos y los espacios que
            // siguen al ultimo salto (sangria) quedan como UN espacio.
            if (newlines > 0) repeat(minOf(newlines, 2)) { out.append('\n') }
            if (spaces > 0) out.append(' ')
          }
          spaces = 0
          newlines = 0
          out.append(c)
        }
      }
      i += 1
    }
    while (nextAnchor < pending.size) {
      anchors[pending[nextAnchor].key] = out.length
      nextAnchor += 1
    }
    return HtmlTextResult(out.toString(), anchors)
  }

  private fun pendingLength(out: StringBuilder, newlines: Int, spaces: Int): Int =
    if (out.isEmpty()) 0 else (if (newlines > 0) minOf(newlines, 2) else 0) + (if (spaces > 0) 1 else 0)

  private fun isWordLetter(c: Char): Boolean =
    (c in 'A'..'Z') || (c in 'a'..'z') || (c.code in 0x00C0..0x024F)

  // ── Etiquetas (sobre indices, sin copiar) ───────────────────────────────

  private fun lowerAscii(c: Char): Char = if (c in 'A'..'Z') (c.code + 32).toChar() else c

  /** El nombre de etiqueta en html[start, start+length) es `expected` (minusculas), sin distinguir mayusculas. */
  private fun nameIs(html: String, start: Int, length: Int, expected: String): Boolean {
    if (length != expected.length) return false
    for (k in 0 until length) if (lowerAscii(html[start + k]) != expected[k]) return false
    return true
  }

  private fun isParagraphCloser(html: String, start: Int, length: Int): Boolean {
    if (length == 1) return lowerAscii(html[start]) == 'p'
    if (length == 2) {
      val first = lowerAscii(html[start])
      val second = html[start + 1]
      return (first == 'h' && second in '1'..'6') || (first == 'l' && lowerAscii(second) == 'i') || (first == 't' && lowerAscii(second) == 'r')
    }
    return nameIs(html, start, length, "blockquote")
  }

  /** Valor del atributo id (o name) entre from y close, o null. */
  private fun anchorAttribute(html: String, from: Int, close: Int): String? {
    var id: String? = null
    var name: String? = null
    var i = from
    while (i < close) {
      // Espacios antes del atributo.
      while (i < close && html[i].isWhitespace()) i += 1
      if (i >= close) break
      val attrStart = i
      while (i < close && !html[i].isWhitespace() && html[i] != '=' && html[i] != '/') i += 1
      val attrLength = i - attrStart
      while (i < close && html[i] == ' ') i += 1
      if (i < close && html[i] == '=') {
        i += 1
        while (i < close && html[i] == ' ') i += 1
        if (i < close && (html[i] == '"' || html[i] == '\'')) {
          val quote = html[i]
          val valueEnd = html.indexOf(quote, i + 1)
          if (valueEnd < 0 || valueEnd > close) return id ?: name
          if (id == null && nameIs(html, attrStart, attrLength, "id")) id = html.substring(i + 1, valueEnd)
          else if (name == null && nameIs(html, attrStart, attrLength, "name")) name = html.substring(i + 1, valueEnd)
          i = valueEnd + 1
        } else {
          // Valor sin comillas: se saltea.
          while (i < close && !html[i].isWhitespace()) i += 1
        }
      } else if (i == attrStart) {
        i += 1 // caracter suelto ('/', '=')
      }
    }
    return id ?: name
  }

  /** Posicion de "<name" seguido de espacio, '>' o '/', sin distinguir mayusculas. */
  private fun findOpeningTag(html: String, name: String, from: Int): Int {
    var at = html.indexOf('<', from)
    while (at >= 0) {
      val nameStart = at + 1
      if (nameStart + name.length <= html.length && nameIs(html, nameStart, name.length, name)) {
        val after = nameStart + name.length
        if (after >= html.length || html[after].isWhitespace() || html[after] == '>' || html[after] == '/') return at
      }
      at = html.indexOf('<', at + 1)
    }
    return -1
  }

  /** Posicion de "</name" (seguido de '>' o espacio), sin distinguir mayusculas. */
  private fun findClosingTag(html: String, name: String, from: Int): Int {
    var at = html.indexOf("</", from)
    while (at >= 0) {
      val nameStart = at + 2
      if (nameStart + name.length <= html.length && nameIs(html, nameStart, name.length, name)) {
        val after = nameStart + name.length
        if (after >= html.length || html[after] == '>' || html[after].isWhitespace()) return at
      }
      at = html.indexOf("</", at + 2)
    }
    return -1
  }

  // ── Entidades ────────────────────────────────────────────────────────────

  private fun indexOfSemicolon(html: String, from: Int, limit: Int): Int {
    var i = from
    while (i < limit) {
      if (html[i] == ';') return i
      i += 1
    }
    return -1
  }

  private fun decodeEntity(html: String, from: Int, to: Int): String? {
    if (to <= from) return null
    if (html[from] == '#') {
      val hex = from + 1 < to && (html[from + 1] == 'x' || html[from + 1] == 'X')
      val digitsFrom = if (hex) from + 2 else from + 1
      if (digitsFrom >= to) return null
      var code = 0L
      for (k in digitsFrom until to) {
        val digit = Character.digit(html[k], if (hex) 16 else 10)
        if (digit < 0) return null
        code = code * (if (hex) 16 else 10) + digit
        if (code > 0x10FFFF) return null
      }
      if (code <= 0) return null
      return String(Character.toChars(code.toInt()))
    }
    for (k in from until to) if (!html[k].isLetter()) return null
    val body = html.substring(from, to)
    return NAMED_ENTITIES[body] ?: NAMED_ENTITIES[body.lowercase()]
  }
}
