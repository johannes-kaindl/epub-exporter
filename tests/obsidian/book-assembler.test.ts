import { describe, it, expect } from "vitest";
import { assembleBook, AssemblerDeps, NoteData } from "../../src/obsidian/book-assembler";
import { DEFAULT_FOLDER_OPTIONS, type FolderBookOptions } from "../../src/core/folder-tree";

// A fake vault: notes keyed by path, images keyed by src, plus a rendered-DOM
// stand-in. renderMarkdown returns a jsdom-free fake root whose querySelectorAll
// and childNodes drive domToXhtml — but to keep the test pure we render a tiny
// DOM using the linkedom-free approach: we feed pre-built HTML through a minimal
// DOM. vitest's jsdom env gives us document.
// @vitest-environment jsdom

function makeDeps(
  notes: Record<string, NoteData>,
  images: Record<string, { path: string; n: number }>,
  codes: Record<string, { lang?: string; text: string }[]> = {}
): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown; // test notes provide HTML bodies directly
      return { root, dispose: () => {}, codes: codes[sourcePath] ?? [] };
    },
    async readNote(path) {
      return notes[path] ?? null;
    },
    resolveNotePath(target, _sourcePath) {
      // test targets are exact note paths (with or without .md)
      const withMd = target.endsWith(".md") ? target : target + ".md";
      if (notes[withMd]) return withMd;
      if (notes[target]) return target;
      return null;
    },
    async readImage(target, _sourcePath) {
      const hit = images[target];
      return hit ? { data: new Uint8Array([hit.n, hit.n]), path: hit.path } : null;
    },
    async listFolderNotes(folderPath) {
      return Object.keys(notes).filter((p) => p.startsWith(folderPath + "/"));
    },
  };
}

const note = (path: string, body: string, frontmatter: Record<string, unknown> = {}): NoteData => ({
  path,
  basename: path.replace(/\.md$/, "").split("/").pop()!,
  frontmatter,
  body,
});

const opts = { defaultLanguage: "en", rng: () => 0.5 };

describe("assembleBook — book note with embeds", () => {
  it("builds chapters from top-level embeds in order with book metadata", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "My Book", author: "Jay", language: "de" }),
      "Intro.md": note("Intro.md", "<p>intro text</p>"),
      "Body.md": note("Body.md", "<p>body text</p>"),
    };
    const { book, missing } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.metadata.title).toBe("My Book");
    expect(book.metadata.language).toBe("de");
    expect(book.chapters.map((c) => c.title)).toEqual(["Intro", "Body"]);
    expect(book.chapters[0].xhtml).toContain("intro text");
    expect(missing).toEqual([]);
  });

  it("records a missing embed target instead of throwing", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Gone]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", "<p>x</p>"),
    };
    const { book, missing } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["Intro"]);
    expect(missing).toEqual(["Gone"]);
  });

  it("rewrites a cross-chapter link to the target chapter file", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", '<p>see <a data-href="Body" href="Body" class="internal-link">Body</a></p>'),
      "Body.md": note("Body.md", "<p>body</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.chapters[0].xhtml).toContain('href="chapter-02.xhtml"');
  });

  it("embeds a chapter image and reports none simplified for a supported image", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", '<p><img src="pic.png" alt=""></p>'),
    };
    const { book, simplifiedCount } = await assembleBook(makeDeps(notes, { "pic.png": { path: "pic.png", n: 7 } }), { kind: "note", path: "Book.md" }, opts);
    expect(book.images).toHaveLength(1);
    expect(book.chapters[0].xhtml).toContain("images/img-01.png");
    expect(simplifiedCount).toBe(0);
  });
});

describe("assembleBook — single note", () => {
  it("produces one chapter with basename fallback title", async () => {
    const notes = { "Solo.md": note("Solo.md", "<p>hello</p>") };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Solo.md" }, opts);
    expect(book.chapters).toHaveLength(1);
    expect(book.metadata.title).toBe("Solo");
    expect(book.chapters[0].xhtml).toContain("hello");
  });
});

describe("assembleBook — folder", () => {
  it("orders chapters by filename and titles the book from the folder", async () => {
    const notes = {
      "Bk/02 Two.md": note("Bk/02 Two.md", "<p>two</p>"),
      "Bk/01 One.md": note("Bk/01 One.md", "<p>one</p>"),
      "Bk/10 Ten.md": note("Bk/10 Ten.md", "<p>ten</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "folder", path: "Bk", options: DEFAULT_FOLDER_OPTIONS }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["01 One", "02 Two", "10 Ten"]);
    expect(book.metadata.title).toBe("Bk");
  });
});

describe("assembleBook — folder tree", () => {
  const readme = (dir: string, body = "<p>r</p>") => note(`${dir}/README.md`, body);
  const options = (over: Partial<FolderBookOptions> = {}): FolderBookOptions => ({ ...DEFAULT_FOLDER_OPTIONS, introNames: ["README"], ...over });
  const folder = (path: string, over?: Partial<FolderBookOptions>) => ({ kind: "folder" as const, path, options: options(over) });

  it("links [x](README.md) to the README next to the page, not to the last README registered", async () => {
    const notes = {
      "docs/README.md": readme("docs", "<p>root</p>"),
      "docs/tutorials/README.md": readme("docs/tutorials", "<p>tut</p>"),
      "docs/tutorials/lektion-01.md": note(
        "docs/tutorials/lektion-01.md",
        '<p><a data-href="README.md" href="README.md" class="internal-link">x</a> <a data-href="../README.md" href="../README.md">up</a></p>'
      ),
      "docs/reference/README.md": readme("docs/reference", "<p>ref</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), folder("docs"), opts);
    const order = book.chapters.map((c) => c.sourcePath);
    expect(order).toEqual(["docs/README.md", "docs/reference/README.md", "docs/tutorials/README.md", "docs/tutorials/lektion-01.md"]);
    const lesson = book.chapters[order.indexOf("docs/tutorials/lektion-01.md")].xhtml;
    const file = (path: string) => `chapter-${String(order.indexOf(path) + 1).padStart(2, "0")}.xhtml`;
    expect(lesson).toContain(`href="${file("docs/tutorials/README.md")}"`);
    expect(lesson).toContain(`href="${file("docs/README.md")}"`);
    expect(lesson).not.toContain(`href="${file("docs/reference/README.md")}"`);
  });

  it("builds a nested toc: intro is the chapter entry, a chapter without intro points at its first page, the root intro comes first", async () => {
    const notes = {
      "docs/README.md": readme("docs"),
      "docs/STAND.md": note("docs/STAND.md", "<p>s</p>", { chapter_title: "Stand" }),
      "docs/tutorials/README.md": readme("docs/tutorials"),
      "docs/tutorials/lektion-01.md": note("docs/tutorials/lektion-01.md", "<p>1</p>"),
      "docs/explanation/farbsystem.md": note("docs/explanation/farbsystem.md", "<p>f</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), folder("docs"), opts);
    const idx = (path: string) => book.chapters.findIndex((c) => c.sourcePath === path);
    expect(book.toc).toEqual([
      { title: "README", chapterIndex: idx("docs/README.md"), children: [] },
      { title: "explanation", chapterIndex: idx("docs/explanation/farbsystem.md"), children: [{ title: "farbsystem", chapterIndex: idx("docs/explanation/farbsystem.md"), children: [] }] },
      { title: "Stand", chapterIndex: idx("docs/STAND.md"), children: [] },
      { title: "tutorials", chapterIndex: idx("docs/tutorials/README.md"), children: [{ title: "lektion-01", chapterIndex: idx("docs/tutorials/lektion-01.md"), children: [] }] },
    ]);
  });

  it("titles the pages by first heading when asked, the book by the folder name", async () => {
    const notes = { "Bk/a.md": note("Bk/a.md", "# Erklärung\n\ntext") };
    const heading = await assembleBook(makeDeps(notes, {}), folder("Bk", { titleFromHeading: true }), { ...opts, defaultLanguage: "de" });
    expect(heading.book.chapters[0].title).toBe("Erklärung");
    expect(heading.book.metadata.title).toBe("Bk");
    expect(heading.book.metadata.language).toBe("de");
    const plain = await assembleBook(makeDeps(notes, {}), folder("Bk", { titleFromHeading: false }), opts);
    expect(plain.book.chapters[0].title).toBe("a");
  });

  it("names the book by the number rule: '01 - Handbuch' becomes 'Handbuch'", async () => {
    const notes = { "x/01 - Handbuch/a.md": note("x/01 - Handbuch/a.md", "<p>a</p>") };
    const { book } = await assembleBook(makeDeps(notes, {}), folder("x/01 - Handbuch", { numberPrefix: true }), opts);
    expect(book.metadata.title).toBe("Handbuch");
  });

  it("returns no chapters and no toc when every page is hidden or excluded", async () => {
    const notes = {
      "Bk/0 - Entwurf/a.md": note("Bk/0 - Entwurf/a.md", "<p>a</p>"),
      "Bk/b.md": note("Bk/b.md", "<p>b</p>", { epub_exclude: true }),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), folder("Bk", { numberPrefix: true }), opts);
    expect(book.chapters).toHaveLength(0);
    expect(book.toc ?? []).toEqual([]);
  });

  it("records an unreadable note in missing and builds the rest", async () => {
    const notes = { "Bk/a.md": note("Bk/a.md", "<p>a</p>") };
    const deps = makeDeps(notes, {});
    const { book, missing } = await assembleBook({ ...deps, listFolderNotes: async () => ["Bk/a.md", "Bk/gone.md"] }, folder("Bk"), opts);
    expect(book.chapters.map((c) => c.sourcePath)).toEqual(["Bk/a.md"]);
    expect(missing).toEqual(["Bk/gone.md"]);
  });

  it("leaves a link to a page outside the book as plain text", async () => {
    const notes = {
      "Bk/a.md": note("Bk/a.md", '<p><a data-href="b.md" href="b.md">b</a></p>'),
      "Bk/b.md": note("Bk/b.md", "<p>b</p>", { epub_exclude: true }),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), folder("Bk"), opts);
    expect(book.chapters[0].xhtml).not.toContain("<a ");
    expect(book.chapters[0].xhtml).toContain("b");
  });
});

describe("assembleBook — epub_exclude", () => {
  it("skips an embedded chapter marked epub_exclude in book-note mode", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", "<p>intro</p>"),
      "Body.md": note("Body.md", "<p>body</p>", { epub_exclude: true }),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["Intro"]);
  });

  it("skips a folder note marked epub_exclude", async () => {
    const notes = {
      "Bk/01 One.md": note("Bk/01 One.md", "<p>one</p>"),
      "Bk/02 Two.md": note("Bk/02 Two.md", "<p>two</p>", { epub_exclude: true }),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "folder", path: "Bk", options: DEFAULT_FOLDER_OPTIONS }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["01 One"]);
  });
});

describe("assembleBook — failed image resolution", () => {
  it("counts a missing image as simplified and adds nothing to book.images", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", '<p><img src="missing.png" alt=""></p>'),
    };
    const { book, simplifiedCount } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(simplifiedCount).toBe(1);
    expect(book.images).toEqual([]);
  });
});

describe("assembleBook — per-chapter and cover sourcePath", () => {
  function makeDepsWithSourceTracking(
    notes: Record<string, NoteData>,
    images: Record<string, { path: string; n: number }>,
    calls: Array<{ target: string; sourcePath: string }>
  ): AssemblerDeps {
    const base = makeDeps(notes, images);
    return {
      ...base,
      async readImage(target, sourcePath) {
        calls.push({ target, sourcePath });
        return base.readImage(target, sourcePath);
      },
    };
  }

  it("resolves each chapter's images against that chapter's own note path, and the cover against the book note's path", async () => {
    const calls: Array<{ target: string; sourcePath: string }> = [];
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "B", cover: "cover.png" }),
      "Intro.md": note("Intro.md", '<p><img src="intro-pic.png" alt=""></p>'),
      "Body.md": note("Body.md", '<p><img src="body-pic.png" alt=""></p>'),
    };
    const images = {
      "intro-pic.png": { path: "intro-pic.png", n: 1 },
      "body-pic.png": { path: "body-pic.png", n: 2 },
      "cover.png": { path: "cover.png", n: 3 },
    };
    const { book } = await assembleBook(
      makeDepsWithSourceTracking(notes, images, calls),
      { kind: "note", path: "Book.md" },
      opts
    );

    expect(book.coverImageId).toBeDefined();
    expect(book.images).toHaveLength(3);

    const introCall = calls.find((c) => c.target === "intro-pic.png");
    const bodyCall = calls.find((c) => c.target === "body-pic.png");
    const coverCall = calls.find((c) => c.target === "cover.png");

    expect(introCall?.sourcePath).toBe("Intro.md");
    expect(bodyCall?.sourcePath).toBe("Body.md");
    expect(coverCall?.sourcePath).toBe("Book.md");
  });
});

describe("assembleBook — code-block restore", () => {
  it("re-injects extracted fenced code as <pre><code> in the chapter XHTML", async () => {
    // The book-note body already carries the post-render placeholder paragraph;
    // codes[sourcePath] supplies the captured fence, as the real renderMarkdown would.
    const notes = {
      "N.md": note("N.md", "<p>EPUBEXPORTERCODE0</p>", { epub: true, title: "T" }),
    };
    const deps = makeDeps(notes, {}, { "N.md": [{ lang: "js", text: "a<b" }] });
    const { book } = await assembleBook(deps, { kind: "note", path: "N.md" }, opts);
    expect(book.chapters[0].xhtml).toContain('<pre><code class="language-js">a&lt;b</code></pre>');
  });
});
