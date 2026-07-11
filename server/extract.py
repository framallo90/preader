#!/usr/bin/env python3
"""Extrae texto completo + portada de un PDF/EPUB/TXT con PyMuPDF.

Uso: extract.py <archivo> <salida.txt> [portada.png]
stdout JSON: {"chars": N, "pages": N, "title": ..., "cover": true|false}
"""
import json
import sys

MAX_CHARS = 30_000_000  # techo de seguridad (archivos patológicos)
COVER_WIDTH = 600  # px — alcanza para tarjetas de biblioteca


def render_cover(doc, dst: str) -> bool:
    """Renderiza la primera página 'con tinta' (la tapa suele ser la página 1;
    si viene en blanco, prueba las siguientes)."""
    import fitz

    for page_index in range(min(3, doc.page_count)):
        page = doc[page_index]
        zoom = COVER_WIDTH / max(page.rect.width, 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        samples = pix.samples
        non_white = sum(1 for b in samples[:: max(1, len(samples) // 20000)] if b < 240)
        if non_white > 200:  # tiene contenido visible
            pix.save(dst)
            return True
    # Ninguna con tinta: igual guardamos la primera como último recurso.
    if doc.page_count > 0:
        page = doc[0]
        zoom = COVER_WIDTH / max(page.rect.width, 1)
        page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(dst)
        return True
    return False


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    cover_dst = sys.argv[3] if len(sys.argv) > 3 else None

    if src.lower().endswith(".txt"):
        with open(src, encoding="utf-8", errors="replace") as fh:
            text = fh.read(MAX_CHARS)
        with open(dst, "w", encoding="utf-8") as out:
            json.dump({"pages": [text]}, out, ensure_ascii=False)
        print(json.dumps({"chars": len(text), "pages": 0, "title": None, "cover": False}))
        return 0

    import fitz  # PyMuPDF

    doc = fitz.open(src)
    # UNA entrada por página (aunque esté vacía): el índice del array ES el
    # número de página, y permite mapear texto↔página exacto en la app.
    page_texts = []
    total = 0
    for page in doc:
        t = page.get_text("text")
        total += len(t) + 2
        if total > MAX_CHARS:
            print(json.dumps({"error": "document_too_large"}))
            return 2
        page_texts.append(t)

    text = "\n\n".join(p for p in page_texts if p.strip())
    title = (doc.metadata or {}).get("title") or None

    cover_ok = False
    if cover_dst:
        try:
            cover_ok = render_cover(doc, cover_dst)
        except Exception:
            cover_ok = False

    # Aspecto de página (ancho/alto) para que la app calcule el alto al vuelo.
    aspect = None
    if doc.page_count > 0:
        rect = doc[0].rect
        if rect.height > 0:
            aspect = round(rect.width / rect.height, 4)

    with open(dst, "w", encoding="utf-8") as out:
        json.dump({"pages": page_texts}, out, ensure_ascii=False)
    print(json.dumps({
        "chars": len(text),
        "pages": doc.page_count,
        "title": title,
        "cover": cover_ok,
        "pageAspect": aspect,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
