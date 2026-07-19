// tests/epub-e2e.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { assembleBook, AssemblerDeps, NoteData } from "../src/obsidian/book-assembler";
import { buildEpub } from "../src/core/epub-builder";

const note = (path: string, body: string, fm: Record<string, unknown> = {}): NoteData => ({
  path,
  basename: path.replace(/\.md$/, "").split("/").pop()!,
  frontmatter: fm,
  body,
});

function deps(
  notes: Record<string, NoteData>,
  images: Record<string, { path: string; n: number }>,
  codes: Record<string, { lang?: string; text: string }[]> = {}
): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown;
      return { root, dispose: () => {}, codes: codes[sourcePath] ?? [] };
    },
    async readNote(path) { return notes[path] ?? null; },
    resolveNotePath(target) {
      const withMd = target.endsWith(".md") ? target : target + ".md";
      return notes[withMd] ? withMd : notes[target] ? target : null;
    },
    async readImage(target) {
      const hit = images[target];
      return hit ? { data: new Uint8Array([hit.n, hit.n, hit.n, hit.n]), path: hit.path } : null;
    },
    async listFolderNotes() { return []; },
  };
}

describe("EPUB end-to-end", () => {
  it("assembles a book and builds a valid archive shape", async () => {
    const notes = {
      "Book.md": note("Book.md", '![[Intro]]\n![[Body]]', { epub: true, title: "E2E Book", author: "Jay", language: "en" }),
      "Intro.md": note("Intro.md", "<p>hello</p>"),
      "Body.md": note("Body.md", '<p><img src="pic.png" alt="p"></p><p>EPUBEXPORTERCODE0</p>'),
    };
    const images = { "pic.png": { path: "pic.png", n: 7 } };
    const codes = { "Body.md": [{ lang: "js", text: "x < 1" }] };

    const { book } = await assembleBook(deps(notes, images, codes), { kind: "note", path: "Book.md" }, {
      defaultLanguage: "en",
      rng: () => 0.5,
    });
    const bytes = buildEpub(book);
    const files = unzipSync(bytes);

    // mimetype present with exact content
    expect(strFromU8(files["mimetype"])).toBe("application/epub+zip");
    // container + package + nav present
    expect(files["META-INF/container.xml"]).toBeDefined();
    expect(files["OEBPS/content.opf"]).toBeDefined();
    expect(files["OEBPS/nav.xhtml"]).toBeDefined();
    // one chapter file per plan (Intro, Body)
    expect(files["OEBPS/chapter-01.xhtml"]).toBeDefined();
    expect(files["OEBPS/chapter-02.xhtml"]).toBeDefined();
    // image embedded, code block restored, image src rewritten to images/
    expect(files["OEBPS/images/img-01.png"]).toBeDefined();
    const body = strFromU8(files["OEBPS/chapter-02.xhtml"]);
    expect(body).toContain('src="images/img-01.png"');
    expect(body).toContain("<pre><code");
    expect(body).toContain("x &lt; 1");
    // OPF references the title
    expect(strFromU8(files["OEBPS/content.opf"])).toContain("E2E Book");
  });

  it("keeps mimetype as the first, STORED (uncompressed) entry", async () => {
    const notes = { "N.md": note("N.md", "<p>x</p>", { epub: true, title: "T" }) };
    const { book } = await assembleBook(deps(notes, {}), { kind: "note", path: "N.md" }, {
      defaultLanguage: "en",
      rng: () => 0.5,
    });
    const bytes = buildEpub(book);
    // Local file header of the first entry starts at offset 0; the name field begins at 30.
    const name = strFromU8(bytes.slice(30, 38));
    expect(name).toBe("mimetype");
    // Compression method (offset 8, little-endian u16) must be 0 = stored.
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
  });
});
