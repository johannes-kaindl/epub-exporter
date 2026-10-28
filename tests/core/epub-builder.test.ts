import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { buildEpub, DEFAULT_BOOK_CSS } from "../../src/core/epub-builder";
import { Book, TocEntry } from "../../src/core/model";

const dec = (u: Uint8Array) => new TextDecoder().decode(u);

function fixtureBook(): Book {
  return {
    metadata: {
      title: "My Book",
      authors: ["Jay K"],
      language: "en",
      identifier: "urn:uuid:12345678-1234-4123-8123-1234567890ab",
      subjects: ["fiction"],
      modified: "2026-01-01T00:00:00Z",
    },
    chapters: [
      { title: "Intro", xhtml: "<p>hello</p>" },
      { title: "Body", xhtml: '<p>world <img src="images/img-01.png" alt=""/></p>' },
    ],
    images: [
      { id: "img-01", href: "images/img-01.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
    ],
    css: DEFAULT_BOOK_CSS,
  };
}

describe("buildEpub", () => {
  it("puts mimetype first with the correct value", () => {
    const zip = buildEpub(fixtureBook());
    expect(dec(zip.slice(30, 38))).toBe("mimetype");
    const files = unzipSync(zip);
    expect(dec(files["mimetype"])).toBe("application/epub+zip");
  });

  it("emits a container.xml pointing at content.opf", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    expect(dec(files["META-INF/container.xml"])).toContain("OEBPS/content.opf");
  });

  it("lists both chapters in manifest and spine", () => {
    const opf = dec(unzipSync(buildEpub(fixtureBook()))["OEBPS/content.opf"]);
    expect(opf).toContain("<dc:title>My Book</dc:title>");
    expect(opf).toContain('href="chapter-01.xhtml"');
    expect(opf).toContain('href="chapter-02.xhtml"');
    expect(opf).toContain('<itemref idref="chapter-1"/>');
    expect(opf).toContain('<itemref idref="chapter-2"/>');
    expect(opf).toContain('href="images/img-01.png"');
  });

  it("wraps chapter bodies in XHTML and lists them in nav", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    const ch1 = dec(files["OEBPS/chapter-01.xhtml"]);
    expect(ch1).toContain("<title>Intro</title>");
    expect(ch1).toContain("<p>hello</p>");
    const nav = dec(files["OEBPS/nav.xhtml"]);
    expect(nav).toContain('<a href="chapter-01.xhtml">Intro</a>');
    expect(nav).toContain('<a href="chapter-02.xhtml">Body</a>');
  });

  it("embeds image bytes unchanged", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    expect(Array.from(files["OEBPS/images/img-01.png"])).toEqual([1, 2, 3]);
  });

  it("marks the cover image in the manifest when coverImageId is set", () => {
    const book = fixtureBook();
    book.coverImageId = "img-01";
    const opf = dec(unzipSync(buildEpub(book))["OEBPS/content.opf"]);
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('name="cover" content="img-01"');
  });

  it("throws when the book has no chapters", () => {
    const book = fixtureBook();
    book.chapters = [];
    expect(() => buildEpub(book)).toThrow(/no chapters/i);
  });
});

describe("buildEpub — nested table of contents", () => {
  const compact = (xml: string) => xml.replace(/>\s+</g, "><");

  function chapterBook(titles: string[], toc?: TocEntry[]): Book {
    return {
      metadata: {
        title: "Tree",
        authors: ["Jay K"],
        language: "en",
        identifier: "urn:uuid:12345678-1234-4123-8123-1234567890ab",
        modified: "2026-01-01T00:00:00Z",
      },
      chapters: titles.map((title) => ({ title, xhtml: "<p>x</p>" })),
      images: [],
      css: DEFAULT_BOOK_CSS,
      ...(toc ? { toc } : {}),
    };
  }

  const entry = (title: string, chapterIndex: number, children: TocEntry[] = []): TocEntry => ({ title, chapterIndex, children });

  // A with two children, then B: the shape of a folder with sub-pages next to a loose page.
  const nested = (): Book =>
    chapterBook(["A", "A1", "A2", "B"], [entry("A", 0, [entry("A1", 1), entry("A2", 2)]), entry("B", 3)]);

  it("renders book.toc as nested <ol> in nav.xhtml, linking by chapterIndex", () => {
    const nav = compact(dec(unzipSync(buildEpub(nested()))["OEBPS/nav.xhtml"]));
    expect(nav).toContain(
      '<ol><li><a href="chapter-01.xhtml">A</a><ol><li><a href="chapter-02.xhtml">A1</a></li>' +
        '<li><a href="chapter-03.xhtml">A2</a></li></ol></li><li><a href="chapter-04.xhtml">B</a></li></ol>',
    );
  });

  it("renders book.toc as nested navPoint in toc.ncx with playOrder 1..n in document order", () => {
    const ncx = dec(unzipSync(buildEpub(nested()))["OEBPS/toc.ncx"]);
    expect(compact(ncx)).toContain(
      '<navMap><navPoint id="navpoint-1" playOrder="1"><navLabel><text>A</text></navLabel><content src="chapter-01.xhtml"/>' +
        '<navPoint id="navpoint-2" playOrder="2"><navLabel><text>A1</text></navLabel><content src="chapter-02.xhtml"/></navPoint>' +
        '<navPoint id="navpoint-3" playOrder="3"><navLabel><text>A2</text></navLabel><content src="chapter-03.xhtml"/></navPoint></navPoint>' +
        '<navPoint id="navpoint-4" playOrder="4"><navLabel><text>B</text></navLabel><content src="chapter-04.xhtml"/></navPoint></navMap>',
    );
    const orders = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]));
    expect(orders).toEqual([1, 2, 3, 4]);
  });

  it("numbers navPoints in document order even when the tree is deeper than two levels", () => {
    const deep = chapterBook(["a", "b", "c", "d"], [entry("a", 0, [entry("b", 1, [entry("c", 2)]), entry("d", 3)])]);
    const ncx = dec(unzipSync(buildEpub(deep))["OEBPS/toc.ncx"]);
    expect([...ncx.matchAll(/<text>(\w+)<\/text>/g)].map((m) => m[1]).filter((t) => t.length === 1)).toEqual(["a", "b", "c", "d"]);
    expect([...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4]);
    expect(new Set([...ncx.matchAll(/id="(navpoint-\d+)"/g)].map((m) => m[1])).size).toBe(4);
  });

  it("escapes titles in nested entries", () => {
    const book = chapterBook(["x", "y"], [entry("A & <B>", 0, [entry('"C"', 1)])]);
    const files = unzipSync(buildEpub(book));
    expect(dec(files["OEBPS/nav.xhtml"])).toContain("A &amp; &lt;B&gt;");
    expect(dec(files["OEBPS/nav.xhtml"])).toContain("&quot;C&quot;");
    expect(dec(files["OEBPS/toc.ncx"])).toContain("<text>A &amp; &lt;B&gt;</text>");
  });

  it("lets two entries point at the same chapter file", () => {
    const book = chapterBook(["Intro", "Next"], [entry("Chapter", 0, [entry("Its first page", 0)]), entry("Other", 1)]);
    const files = unzipSync(buildEpub(book));
    const nav = compact(dec(files["OEBPS/nav.xhtml"]));
    expect(nav).toContain('<li><a href="chapter-01.xhtml">Chapter</a><ol><li><a href="chapter-01.xhtml">Its first page</a></li></ol></li>');
    const ncx = dec(files["OEBPS/toc.ncx"]);
    expect([...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3]);
  });

  it("keeps the spine and manifest in chapter order, whatever the toc says", () => {
    const opf = dec(unzipSync(buildEpub(nested()))["OEBPS/content.opf"]);
    expect([...opf.matchAll(/<itemref idref="(chapter-\d+)"\/>/g)].map((m) => m[1])).toEqual(["chapter-1", "chapter-2", "chapter-3", "chapter-4"]);
  });

  it("refuses a toc entry that points at a chapter that does not exist", () => {
    expect(() => buildEpub(chapterBook(["A"], [entry("Dead", 1)]))).toThrow(/chapter/i);
    expect(() => buildEpub(chapterBook(["A"], [entry("Dead", -1)]))).toThrow(/chapter/i);
    expect(() => buildEpub(chapterBook(["A"], [entry("Ok", 0, [entry("Dead", 5)])]))).toThrow(/chapter/i);
  });

  describe("without book.toc", () => {
    // The exact output before the nested toc existed; written down before the builder changed.
    const NAV =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n  <head>\n' +
      '    <meta charset="utf-8"/>\n    <title>Contents</title>\n    <link rel="stylesheet" type="text/css" href="styles/book.css"/>\n  </head>\n  <body>\n' +
      '    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">\n      <h1>Contents</h1>\n      <ol>\n' +
      '        <li><a href="chapter-01.xhtml">Intro &amp; Co</a></li>\n        <li><a href="chapter-02.xhtml">Body</a></li>\n' +
      '      </ol>\n    </nav>\n  </body>\n</html>';
    const NCX =
      '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n' +
      '    <meta name="dtb:uid" content="urn:uuid:12345678-1234-4123-8123-1234567890ab"/>\n  </head>\n  <docTitle><text>Tree</text></docTitle>\n  <navMap>\n' +
      '    <navPoint id="navpoint-1" playOrder="1">\n      <navLabel><text>Intro &amp; Co</text></navLabel>\n      <content src="chapter-01.xhtml"/>\n    </navPoint>\n' +
      '    <navPoint id="navpoint-2" playOrder="2">\n      <navLabel><text>Body</text></navLabel>\n      <content src="chapter-02.xhtml"/>\n    </navPoint>\n' +
      '  </navMap>\n</ncx>';

    it("keeps nav.xhtml and toc.ncx byte-identical to the flat output", () => {
      const files = unzipSync(buildEpub(chapterBook(["Intro & Co", "Body"])));
      expect(dec(files["OEBPS/nav.xhtml"])).toBe(NAV);
      expect(dec(files["OEBPS/toc.ncx"])).toBe(NCX);
    });

    it("treats an empty toc like a missing one", () => {
      const files = unzipSync(buildEpub(chapterBook(["Intro & Co", "Body"], [])));
      expect(dec(files["OEBPS/nav.xhtml"])).toBe(NAV);
      expect(dec(files["OEBPS/toc.ncx"])).toBe(NCX);
    });
  });
});
