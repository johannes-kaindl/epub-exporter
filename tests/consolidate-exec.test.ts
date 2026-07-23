// tests/consolidate-exec.test.ts
import { describe, it, expect } from "vitest";
import { executeConsolidatePlan, ConsolidatePort, ConsolidateContext } from "../src/obsidian/consolidate";
import { ConsolidatePlan } from "../src/core/consolidate-plan";

class FakePort implements ConsolidatePort {
  folders: string[] = [];
  files = new Map<string, string>();     // text files
  binaries: Array<[string, string]> = []; // [source, target]
  moves: Array<[string, string]> = [];
  copies: Array<[string, string]> = [];
  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }
  async createFolder(p: string) { this.folders.push(p); }
  async readBody(p: string) { return this.files.get(p) ?? ""; }
  async copyFile(s: string, t: string) { this.copies.push([s, t]); this.files.set(t, this.files.get(s) ?? ""); }
  async moveFile(s: string, t: string) { this.moves.push([s, t]); this.files.set(t, this.files.get(s) ?? ""); this.files.delete(s); }
  async writeFile(p: string, c: string) { this.files.set(p, c); }
  async copyBinary(s: string, t: string) { this.binaries.push([s, t]); }
}

function plan(over: Partial<ConsolidatePlan> = {}): ConsolidatePlan {
  return {
    folderName: "Book",
    bookNoteName: "Book.md",
    bookNoteBody: "![[01 - A]]",
    chapters: [{ sourcePath: "notes/A.md", targetName: "01 - A.md", rewrites: [] }],
    assets: [],
    coverRewrite: null,
    skipped: 0,
    ...over,
  };
}
const ctx = (over: Partial<ConsolidateContext> = {}): ConsolidateContext => ({
  mode: "copy", bookNoteSourcePath: "src/Book.md", bookNoteFrontmatter: "---\nepub: true\n---", ...over,
});

describe("executeConsolidatePlan", () => {
  it("copy mode creates folder, copies chapters, writes the folder note", async () => {
    const port = new FakePort({ "notes/A.md": "chapter body" });
    const res = await executeConsolidatePlan(port, plan(), ctx());
    expect(port.folders).toContain("Book");
    expect(port.copies).toContainEqual(["notes/A.md", "Book/01 - A.md"]);
    expect(port.files.get("Book/Book.md")).toBe("---\nepub: true\n---\n![[01 - A]]");
    expect(port.moves).toHaveLength(0);
    expect(res.chapterCount).toBe(1);
  });

  it("move mode relocates chapters and the book note", async () => {
    const port = new FakePort({ "notes/A.md": "x", "src/Book.md": "---\nepub: true\n---\nold" });
    await executeConsolidatePlan(port, plan(), ctx({ mode: "move" }));
    expect(port.moves).toContainEqual(["notes/A.md", "Book/01 - A.md"]);
    expect(port.moves).toContainEqual(["src/Book.md", "Book/Book.md"]);
    expect(port.files.get("Book/Book.md")).toBe("---\nepub: true\n---\n![[01 - A]]");
  });

  it("rewrites chapter image refs after copying", async () => {
    const port = new FakePort({ "notes/A.md": "![[pic.png]]" });
    await executeConsolidatePlan(
      port,
      plan({
        chapters: [{ sourcePath: "notes/A.md", targetName: "01 - A.md", rewrites: [{ from: "pic.png", to: "_assets/pic.png" }] }],
        assets: [{ sourcePath: "media/pic.png", targetName: "_assets/pic.png" }],
      }),
      ctx()
    );
    expect(port.files.get("Book/01 - A.md")).toBe("![[_assets/pic.png]]");
    expect(port.binaries).toContainEqual(["media/pic.png", "Book/_assets/pic.png"]);
    expect(port.folders).toContain("Book/_assets");
  });

  it("applies coverRewrite to the folder-note frontmatter", async () => {
    const port = new FakePort({ "notes/A.md": "x" });
    await executeConsolidatePlan(
      port,
      plan({ coverRewrite: "[[_assets/cover.png]]" }),
      ctx({ bookNoteFrontmatter: "---\nepub: true\ncover: \"[[cover.png]]\"\n---" })
    );
    expect(port.files.get("Book/Book.md")).toContain("cover: \"[[_assets/cover.png]]\"");
  });

  it("settles chapter errors into the result instead of aborting", async () => {
    const port = new FakePort();
    port.copyFile = async () => { throw new Error("boom"); };
    const res = await executeConsolidatePlan(port, plan(), ctx());
    expect(res.errors.length).toBe(1);
    expect(port.files.has("Book/Book.md")).toBe(true); // still wrote the folder note
  });
});
