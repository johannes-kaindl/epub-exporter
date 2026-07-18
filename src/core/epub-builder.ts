import { Book } from "./model";
import { createZip, ZipEntry } from "./zip-writer";

const MIMETYPE = "application/epub+zip";
const DEFAULT_MODIFIED = "2026-01-01T00:00:00Z";
const enc = (s: string) => new TextEncoder().encode(s);

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function wrapXhtml(title: string, lang: string, bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xmlEscape(lang)}" lang="${xmlEscape(lang)}">
  <head>
    <meta charset="utf-8"/>
    <title>${xmlEscape(title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
${bodyInner}
  </body>
</html>`;
}

function buildOpf(book: Book): string {
  const m = book.metadata;
  const modified = m.modified ?? DEFAULT_MODIFIED;

  const manifest: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles/book.css" media-type="text/css"/>`,
  ];
  book.chapters.forEach((_, i) => {
    manifest.push(
      `<item id="chapter-${i + 1}" href="${chapterFileName(i)}" media-type="application/xhtml+xml"/>`
    );
  });
  for (const img of book.images) {
    const props = img.id === book.coverImageId ? ` properties="cover-image"` : "";
    manifest.push(
      `<item id="${xmlEscape(img.id)}" href="${xmlEscape(img.href)}" media-type="${xmlEscape(img.mediaType)}"${props}/>`
    );
  }

  const spine = book.chapters
    .map((_, i) => `<itemref idref="chapter-${i + 1}"/>`)
    .join("\n    ");

  const creators = m.authors
    .map((a, i) => `<dc:creator id="creator-${i}">${xmlEscape(a)}</dc:creator>`)
    .join("\n    ");

  const optional = [
    m.description ? `<dc:description>${xmlEscape(m.description)}</dc:description>` : "",
    m.publisher ? `<dc:publisher>${xmlEscape(m.publisher)}</dc:publisher>` : "",
    m.date ? `<dc:date>${xmlEscape(m.date)}</dc:date>` : "",
    m.rights ? `<dc:rights>${xmlEscape(m.rights)}</dc:rights>` : "",
    ...(m.subjects ?? []).map((s) => `<dc:subject>${xmlEscape(s)}</dc:subject>`),
    m.series ? `<meta property="belongs-to-collection" id="c01">${xmlEscape(m.series)}</meta>` : "",
    m.series && m.seriesIndex
      ? `<meta refines="#c01" property="group-position">${xmlEscape(m.seriesIndex)}</meta>`
      : "",
    book.coverImageId ? `<meta name="cover" content="${xmlEscape(book.coverImageId)}"/>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xmlEscape(m.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${xmlEscape(m.identifier)}</dc:identifier>
    <dc:title>${xmlEscape(m.title)}</dc:title>
    <dc:language>${xmlEscape(m.language)}</dc:language>
    ${creators}
    ${optional}
    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;
}

function buildNav(book: Book): string {
  const items = book.chapters
    .map((c, i) => `<li><a href="${chapterFileName(i)}">${xmlEscape(c.title)}</a></li>`)
    .join("\n        ");
  return wrapXhtml(
    "Contents",
    book.metadata.language,
    `    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Contents</h1>
      <ol>
        ${items}
      </ol>
    </nav>`
  );
}

function buildNcx(book: Book): string {
  const navPoints = book.chapters
    .map(
      (c, i) => `<navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
      <content src="${chapterFileName(i)}"/>
    </navPoint>`
    )
    .join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(book.metadata.identifier)}"/>
  </head>
  <docTitle><text>${xmlEscape(book.metadata.title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;
}

export function buildEpub(book: Book): Uint8Array {
  const entries: ZipEntry[] = [];
  // mimetype MUST be first and stored (createZip stores everything).
  entries.push({ path: "mimetype", data: enc(MIMETYPE) });
  entries.push({ path: "META-INF/container.xml", data: enc(CONTAINER_XML) });
  entries.push({ path: "OEBPS/content.opf", data: enc(buildOpf(book)) });
  entries.push({ path: "OEBPS/nav.xhtml", data: enc(buildNav(book)) });
  entries.push({ path: "OEBPS/toc.ncx", data: enc(buildNcx(book)) });
  entries.push({ path: "OEBPS/styles/book.css", data: enc(book.css) });
  book.chapters.forEach((c, i) => {
    entries.push({
      path: `OEBPS/${chapterFileName(i)}`,
      data: enc(wrapXhtml(c.title, book.metadata.language, c.xhtml)),
    });
  });
  for (const img of book.images) {
    entries.push({ path: `OEBPS/${img.href}`, data: img.data });
  }
  return createZip(entries);
}

export const DEFAULT_BOOK_CSS = `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #ccc; }`;
