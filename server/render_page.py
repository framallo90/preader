#!/usr/bin/env python3
"""Renderiza UNA página de un PDF/EPUB como PNG al ancho pedido.

Uso: render_page.py <archivo> <pagina_0based> <ancho_px> <salida.png>
stdout: JSON {"ok": true, "width": W, "height": H}
"""
import json
import sys

import fitz  # PyMuPDF

MAX_WIDTH = 2048


def main() -> int:
    src, page_index, width, dst = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    width = max(256, min(width, MAX_WIDTH))

    doc = fitz.open(src)
    if page_index < 0 or page_index >= doc.page_count:
        print(json.dumps({"error": "page_out_of_range"}))
        return 2

    page = doc[page_index]
    zoom = width / max(page.rect.width, 1)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(dst)
    print(json.dumps({"ok": True, "width": pix.width, "height": pix.height}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
