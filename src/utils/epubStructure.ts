/**
 * Lectura de la estructura de un EPUB (OPF, índice NCX / nav, XHTML → texto).
 * Funciones puras: el parser (epubDocumentParser) solo les pasa strings.
 */

export type EpubManifestItem = {
  id: string;
  href: string;
  mediaType: string | null;
  properties: string | null;
};

export type EpubTocEntry = {
  title: string;
  /** Ruta del archivo dentro del zip. */
  file: string;
  /** Ancla (#id) dentro del archivo, si la hay. */
  anchor: string | null;
  /** 0 = nivel superior. */
  level: number;
};

/**
 * Atributos de un tag, SIN depender del orden. La versión anterior buscaba
 * `id="…" … href="…"` en ese orden exacto; los EPUB de Project Gutenberg traen
 * `href` antes que `id`, así que no encontraba ningún ítem y el libro no abría.
 */
export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

export function parseManifest(opf: string): Map<string, EpubManifestItem> {
  const items = new Map<string, EpubManifestItem>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if (!attrs.id || !attrs.href) continue;
    items.set(attrs.id, {
      id: attrs.id,
      href: attrs.href,
      mediaType: attrs['media-type'] ?? null,
      properties: attrs.properties ?? null,
    });
  }
  return items;
}

/** Une un href relativo con su carpeta base: resuelve ../, quita #ancla y decodifica %20. */
export function resolveEpubPath(baseDir: string, href: string): string {
  const withoutFragment = href.split('#')[0];
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // href con % suelto: se usa tal cual
  }
  const parts = (baseDir ? `${baseDir}/${decoded}` : decoded).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

/** Archivos de contenido en orden de lectura. */
export function parseSpinePaths(opf: string, opfDir: string): string[] {
  const manifest = parseManifest(opf);
  const paths: string[] = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = parseAttributes(match[0]).idref;
    const item = idref ? manifest.get(idref) : undefined;
    if (item) paths.push(resolveEpubPath(opfDir, item.href));
  }
  return paths;
}

/** Dónde está el índice: nav.xhtml (EPUB 3) y/o toc.ncx (EPUB 2). Rutas dentro del zip. */
export function findTocPaths(opf: string, opfDir: string): { nav: string | null; ncx: string | null } {
  let nav: string | null = null;
  let ncx: string | null = null;
  for (const item of parseManifest(opf).values()) {
    if (!nav && item.properties?.split(/\s+/).includes('nav')) nav = resolveEpubPath(opfDir, item.href);
    if (!ncx && item.mediaType === 'application/x-dtbncx+xml') ncx = resolveEpubPath(opfDir, item.href);
  }
  return { nav, ncx };
}

function splitSrc(baseDir: string, src: string): { file: string; anchor: string | null } {
  const hashIndex = src.indexOf('#');
  const anchor = hashIndex >= 0 ? src.slice(hashIndex + 1) : null;
  return { file: resolveEpubPath(baseDir, src), anchor: anchor || null };
}

/** Índice EPUB 2 (toc.ncx). `ncxDir` es la carpeta del archivo NCX dentro del zip. */
export function parseNcx(ncx: string, ncxDir: string): EpubTocEntry[] {
  const entries: EpubTocEntry[] = [];
  let depth = 0;
  // Se recorren aperturas y cierres de navPoint para saber el nivel de anidado.
  const tokens = /<navPoint\b[^>]*>|<\/navPoint>/gi;
  // `y` (sticky) + lastIndex: busca desde una posición sin copiar el texto.
  const NEXT_MARKER = /<navPoint\b|<\/navPoint>/gi;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(ncx))) {
    if (match[0].startsWith('</')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    // Solo el trozo que va desde este navPoint hasta el siguiente marcador.
    // Antes se copiaba TODO el resto del archivo en cada vuelta y se volvía a
    // barrer: con un índice de 3.000 entradas eso es cuadrático, y en Hermes
    // (donde cortar un string copia de verdad) son cientos de MB movidos.
    const from = match.index + match[0].length;
    NEXT_MARKER.lastIndex = from;
    const nextMarker = NEXT_MARKER.exec(ncx);
    const to = nextMarker ? nextMarker.index : ncx.length;
    const own = ncx.slice(from, to);
    const title = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(own)?.[1];
    const contentTag = /<content\b[^>]*>/i.exec(own)?.[0];
    const src = contentTag ? parseAttributes(contentTag).src : undefined;
    if (title && src) {
      entries.push({ title: cleanTitle(title), ...splitSrc(ncxDir, src), level: depth });
    }
    depth += 1;
  }
  return entries.filter((entry) => entry.title.length > 0);
}

/** Índice EPUB 3 (nav.xhtml): los <a> dentro de <nav epub:type="toc">. */
export function parseNav(nav: string, navDir: string): EpubTocEntry[] {
  const tocNav =
    /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(nav)?.[1] ??
    /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(nav)?.[1];
  if (!tocNav) return [];

  const entries: EpubTocEntry[] = [];
  let depth = -1;
  const tokens = /<ol\b[^>]*>|<\/ol>|<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(tocNav))) {
    const token = match[0].toLowerCase();
    if (token.startsWith('<ol')) depth += 1;
    else if (token.startsWith('</ol')) depth = Math.max(-1, depth - 1);
    else {
      const href = parseAttributes(/<a\b[^>]*>/i.exec(match[0])?.[0] ?? '').href;
      const title = cleanTitle(match[1] ?? '');
      if (href && title) entries.push({ title, ...splitSrc(navDir, href), level: Math.max(depth, 0) });
    }
  }
  return entries;
}

function cleanTitle(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
};

/** Entidades con nombre y numéricas (&#8212; &#x2014;). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** XHTML de un capítulo → texto plano con saltos de párrafo. */
export function htmlToText(html: string): string {
  // Sirve también para un HTML CORTADO (el tramo anterior a un ancla, sin
  // </body>): si no, el texto del <head> se contaba como contenido y las
  // posiciones del índice quedaban corridas.
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  const body = (bodyOpen ? html.slice(bodyOpen.index + bodyOpen[0].length) : html.replace(/<head\b[\s\S]*?<\/head>/i, ''))
    .replace(/<\/body>[\s\S]*$/i, '');
  return decodeEntities(
    body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

/**
 * Todas las anclas (id / name) de un archivo con su posición en el HTML, en una
 * sola pasada. Buscar cada ancla por separado recorría el archivo entero una vez
 * por entrada del índice.
 */
export function indexAnchors(html: string): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    if (!/\b(?:id|name)\s*=/.test(tag[0])) continue;
    const attrs = parseAttributes(tag[0]);
    for (const key of [attrs.id, attrs.name]) {
      if (key && !anchors.has(key)) anchors.set(key, tag.index ?? 0);
    }
  }
  return anchors;
}

/** Expresión para encontrar el comienzo de un título en el texto, tolerando espacios y saltos. */
export function titleProbe(title: string): RegExp | null {
  const words = title.split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('\\s+'), 'i');
}

/** Posición, dentro del HTML, del elemento con ese id (o name); -1 si no está. */
export function findAnchorIndex(html: string, anchor: string): number {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<[^>]+\\b(?:id|name)\\s*=\\s*["']${escaped}["'][^>]*>`, 'i').exec(html);
  return match ? match.index : -1;
}
