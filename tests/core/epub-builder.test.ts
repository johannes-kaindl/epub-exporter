import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { buildEpub, DEFAULT_BOOK_CSS } from "../../src/core/epub-builder";
import { Book } from "../../src/core/model";

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
});
