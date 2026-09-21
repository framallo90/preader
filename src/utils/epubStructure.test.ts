import { describe, it, expect } from 'vitest';

import {
  decodeEntities,
  findAnchorIndex,
  findTocPaths,
  htmlToText,
  parseManifest,
  parseNav,
  parseNcx,
  parseSpinePaths,
  resolveEpubPath,
} from './epubStructure';

// Forma real de un OPF de Project Gutenberg: `href` ANTES que `id`.
const OPF_HREF_FIRST = `
<package>
  <manifest>
    <item href="cover.png" id="item1" media-type="image/png"/>
    <item href="cap%201.xhtml" id="c1" media-type="application/xhtml+xml"/>
    <item href="text/cap2.xhtml" id="c2" media-type="application/xhtml+xml"/>
    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" properties="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1" linear="yes"/>
    <itemref linear="yes" idref="c2"/>
    <itemref idref="no-existe"/>
  </spine>
</package>`;

describe('manifest y spine', () => {
  it('lee los ítems sin importar el orden de los atributos', () => {
    const manifest = parseManifest(OPF_HREF_FIRST);
    expect(manifest.size).toBe(5);
    expect(manifest.get('c1')?.href).toBe('cap%201.xhtml');
    expect(manifest.get('nav')?.properties).toBe('nav');
  });

  it('arma el spine en orden, con rutas resueltas, y saltea idrefs rotos', () => {
    expect(parseSpinePaths(OPF_HREF_FIRST, 'OEBPS')).toEqual(['OEBPS/cap 1.xhtml', 'OEBPS/text/cap2.xhtml']);
    expect(parseSpinePaths(OPF_HREF_FIRST, '')).toEqual(['cap 1.xhtml', 'text/cap2.xhtml']);
  });

  it('encuentra el índice EPUB 2 y EPUB 3', () => {
    expect(findTocPaths(OPF_HREF_FIRST, 'OEBPS')).toEqual({ nav: 'OEBPS/nav.xhtml', ncx: 'OEBPS/toc.ncx' });
  });
});

describe('resolveEpubPath', () => {
  it('resuelve ../, quita el ancla y decodifica', () => {
    expect(resolveEpubPath('OEBPS/text', '../img/a%20b.png#x')).toBe('OEBPS/img/a b.png');
    expect(resolveEpubPath('', 'cap.xhtml#ancla')).toBe('cap.xhtml');
  });
});

describe('parseNcx', () => {
  const ncx = `
  <navMap>
    <navPoint id="np-1" playOrder="1">
      <navLabel><text>Primera parte</text></navLabel>
      <content src="h-1.htm.html#id0"/>
      <navPoint id="np-2" playOrder="2">
        <navLabel><text>Cap&#237;tulo I &amp; pr&oacute;logo</text></navLabel>
        <content src="h-1.htm.html#id1"/>
      </navPoint>
    </navPoint>
    <navPoint id="np-3" playOrder="3">
      <navLabel><text>Segunda parte</text></navLabel>
      <content src="h-2.htm.html"/>
    </navPoint>
  </navMap>`;

  it('lee títulos, archivo, ancla y nivel de anidado', () => {
    expect(parseNcx(ncx, 'OEBPS')).toEqual([
      { title: 'Primera parte', file: 'OEBPS/h-1.htm.html', anchor: 'id0', level: 0 },
      { title: 'Capítulo I & prólogo', file: 'OEBPS/h-1.htm.html', anchor: 'id1', level: 1 },
      { title: 'Segunda parte', file: 'OEBPS/h-2.htm.html', anchor: null, level: 0 },
    ]);
  });
});

describe('parseNav', () => {
  const nav = `
  <nav epub:type="landmarks"><ol><li><a href="x.xhtml">No es el índice</a></li></ol></nav>
  <nav epub:type="toc" id="toc">
    <ol>
      <li><a href="c1.xhtml">Uno</a>
        <ol><li><a href="c1.xhtml#s1"><span>Uno</span> punto uno</a></li></ol>
      </li>
      <li><a href="c2.xhtml">Dos</a></li>
    </ol>
  </nav>`;

  it('toma el nav de tipo toc y respeta el anidado', () => {
    expect(parseNav(nav, '')).toEqual([
      { title: 'Uno', file: 'c1.xhtml', anchor: null, level: 0 },
      { title: 'Uno punto uno', file: 'c1.xhtml', anchor: 's1', level: 1 },
      { title: 'Dos', file: 'c2.xhtml', anchor: null, level: 0 },
    ]);
  });
});

describe('texto', () => {
  it('decodifica entidades con nombre y numéricas', () => {
    expect(decodeEntities('A&#8212;B &#x2014; &ntilde; &amp; &desconocida;')).toBe('A—B — ñ & &desconocida;');
  });

  it('convierte XHTML en texto con saltos de párrafo y sin el head', () => {
    const html = '<html><head><title>No va</title><style>p{}</style></head><body><h2>T&iacute;tulo</h2><p>Uno<br/>dos.</p><p>Tres.</p></body></html>';
    expect(htmlToText(html)).toBe('Título\n\nUno\ndos.\n\nTres.');
  });

  it('un HTML cortado antes de un ancla no cuenta el head como texto', () => {
    const html = '<html><head><title>Título del archivo</title></head><body><p>Uno.</p><h2 id="c2">Dos</h2><p>Tres.</p></body></html>';
    const prefix = html.slice(0, findAnchorIndex(html, 'c2'));
    expect(htmlToText(prefix)).toBe('Uno.');
    // El largo del prefijo ubica el ancla dentro del texto completo.
    expect(htmlToText(html).slice(htmlToText(prefix).length).trim().startsWith('Dos')).toBe(true);
  });

  it('ubica un ancla por id o por name', () => {
    const html = '<p>antes</p><h2 class="x" id="cap.1">Capítulo</h2><a name="viejo"></a>';
    expect(findAnchorIndex(html, 'cap.1')).toBe(html.indexOf('<h2'));
    expect(findAnchorIndex(html, 'viejo')).toBe(html.indexOf('<a name'));
    expect(findAnchorIndex(html, 'no-esta')).toBe(-1);
  });
});
