import { describe, it, expect } from "vitest";
import { assembleBook, AssemblerDeps, NoteData } from "../../src/obsidian/book-assembler";

// A fake vault: notes keyed by path, images keyed by src, plus a rendered-DOM
// stand-in. renderMarkdown returns a jsdom-free fake root whose querySelectorAll
// and childNodes drive domToXhtml — but to keep the test pure we render a tiny
// DOM using the linkedom-free approach: we feed pre-built HTML through a minimal
// DOM. vitest's jsdom env gives us document.
// @vitest-environment jsdom

function makeDeps(notes: Record<string, NoteData>, images: Record<string, { path: string; n: number }>): AssemblerDeps {
  return {
    async renderMarkdown(markdown, _sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown; // test notes provide HTML bodies directly
      return { root, dispose: () => {} };
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
      return Object.keys(notes).filter((p) => p.startsWith(folderPath + "/") && !p.slice(folderPath.length + 1).includes("/"));
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
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "folder", path: "Bk" }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["01 One", "02 Two", "10 Ten"]);
    expect(book.metadata.title).toBe("Bk");
  });
});
