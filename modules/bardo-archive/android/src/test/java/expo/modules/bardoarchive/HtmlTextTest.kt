package expo.modules.bardoarchive

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Paridad con htmlToText + normalizeExtractedText de src/utils (JavaScript).
 * Los fixtures se generan con el script de paridad (HTML de cada capitulo y el
 * texto que produce la version JS); si no estan, solo corren los casos chicos.
 */
class HtmlTextTest {
  @Test
  fun basics() {
    val html = "<html><head><title>T</title><style>p{}</style></head><body><h1 id=\"c1\">Cap&iacute;tulo 1</h1>" +
      "<p>Hola   <b>mundo</b>.<br/>Segunda l&#237;nea.</p><script>var x = 1;</script><div id='d'>Fin&nbsp;&amp;</div></body></html>"
    val result = HtmlText.convert(html)
    assertEquals("Capítulo 1\n\nHola mundo.\nSegunda línea.\n\nFin &", result.text)
    assertEquals(0, result.anchors["c1"])
    assertEquals(result.text.indexOf("Fin"), result.anchors["d"])
  }

  @Test
  fun hyphenJoinAndWhitespace() {
    val result = HtmlText.convert("<body><p>pala-\nbra  y   otra \t \n\n\n\n cosa</p></body>")
    // La sangria despues del ultimo salto queda como un espacio (igual que la version JS).
    assertEquals("palabra y otra\n\n cosa", result.text)
  }

  @Test
  fun parityWithJavaScriptFixtures() {
    val dir = File(System.getenv("HTMLTEXT_FIXTURES") ?: "")
    if (!dir.isDirectory) return
    var checked = 0
    var index = 0
    while (true) {
      val html = File(dir, "$index.html")
      val expected = File(dir, "$index.txt")
      if (!html.exists()) break
      val actual = HtmlText.convert(html.readText()).text
      val want = expected.readText()
      if (actual != want) {
        var at = 0
        while (at < actual.length && at < want.length && actual[at] == want[at]) at += 1
        val ctxA = actual.substring(maxOf(0, at - 40), minOf(actual.length, at + 40))
        val ctxW = want.substring(maxOf(0, at - 40), minOf(want.length, at + 40))
        throw AssertionError("archivo $index difiere en $at:\n kotlin: <$ctxA>\n js:     <$ctxW>")
      }
      checked += 1
      index += 1
    }
    assertTrue("sin fixtures", checked > 0)
    println("paridad ok en $checked archivos")
  }
}
