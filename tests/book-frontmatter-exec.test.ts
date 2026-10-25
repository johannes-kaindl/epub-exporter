import { describe, it, expect } from "vitest";
import { TFile, type App } from "obsidian";
import { BOOK_FRONTMATTER_TEMPLATE } from "../src/core/frontmatter";
import { insertBookFrontmatter } from "../src/obsidian/book-frontmatter";
import { parseFrontmatter } from "../src/vendor/kit/frontmatter";

function fakeApp(content: string): { app: App; file: TFile; read: () => string; writes: () => number } {
  const file = Object.assign(new TFile(), { path: "Books/Salt Marsh.md", extension: "md" });
  let text = content;
  let writes = 0;
  const vault = {
    process: async (_f: TFile, fn: (data: string) => string) => {
      const next = fn(text);
      if (next !== text) writes++;
      text = next;
      return text;
    },
  };
  return { app: { vault } as unknown as App, file, read: () => text, writes: () => writes };
}

const lone = (s: string): number => (s.match(/(?<!\r)\n/g) ?? []).length;
const TEMPLATE_KEYS = Object.keys(BOOK_FRONTMATTER_TEMPLATE);

async function run(content: string) {
  const { app, file, read, writes } = fakeApp(content);
  const result = await insertBookFrontmatter(app, file);
  return { result, out: read(), writes: writes(), app, file, read };
}

describe("insertBookFrontmatter", () => {
  it("a note without a block gets one with every template field, in template order, body untouched", async () => {
    const { result, out } = await run("# Salt\nText\n");
    expect(result).toEqual({ ok: true, changed: true });
    expect(out.startsWith("---\nepub: true\n")).toBe(true);
    expect(out.endsWith("---\n# Salt\nText\n")).toBe(true);
    const { data, order } = parseFrontmatter(out);
    expect(order).toEqual(TEMPLATE_KEYS);
    expect(data.language).toBe("en");
  });

  it("writes `epub: true` as a plain boolean, not as the text \"true\"", async () => {
    const { out } = await run("# Salt\n");
    expect(out).toContain("\nepub: true\n");
    expect(out).not.toContain('epub: "true"');
  });

  it("writes the list field as an empty list", async () => {
    const { out } = await run("# Salt\n");
    expect(out).toContain("\nsubject: []\n");
  });

  it("a note with a block keeps its own lines byte for byte: a comment, a flow list, an existing title", async () => {
    const own = "title: Mein Buch\nfoo: [a, b]\n# Hinweis\n";
    const { result, out } = await run(`---\n${own}---\nBody\n`);
    expect(result).toEqual({ ok: true, changed: true });
    expect(out.startsWith(`---\n${own}`)).toBe(true);
    expect(out.endsWith("---\nBody\n")).toBe(true);
    expect(out.match(/^title:/gm)).toHaveLength(1);
    expect(out).toContain("\nepub: true\n");
  });

  it("adds only the missing template fields and never overwrites a value", async () => {
    const { out } = await run("---\nepub: false\nauthor: Jay K\nlanguage: de\nsubject:\n  - sea\n---\nBody\n");
    const { data } = parseFrontmatter(out);
    expect(data.epub).toBe("false");
    expect(data.author).toBe("Jay K");
    expect(data.language).toBe("de");
    expect(data.subject).toEqual(["sea"]);
    expect(out.match(/^subject:/gm)).toHaveLength(1);
    expect(out).toContain("\ntitle:");
  });

  it("a CRLF note stays CRLF throughout, block and body", async () => {
    const { out } = await run("---\r\ntitle: Salt\r\n---\r\n# Salt\r\nText\r\n");
    expect(lone(out)).toBe(0);
    expect(out).toContain("\r\nepub: true\r\n");
  });

  it("a CRLF note without a block gets a CRLF block", async () => {
    const { out } = await run("# Salt\r\nText\r\n");
    expect(lone(out)).toBe(0);
    expect(out.startsWith("---\r\nepub: true\r\n")).toBe(true);
  });

  it("is idempotent: a second run changes nothing and does not write", async () => {
    const first = fakeApp("---\ntitle: X\n---\nBody\n");
    await insertBookFrontmatter(first.app, first.file);
    const once = first.read();
    const again = await insertBookFrontmatter(first.app, first.file);
    expect(again).toEqual({ ok: true, changed: false });
    expect(first.read()).toBe(once);
    expect(first.writes()).toBe(1);
  });

  it("a block that never closes is left as it is and reported", async () => {
    const src = "---\ntitle: X\nBody without a closing fence\n";
    const { result, out } = await run(src);
    expect(result).toEqual({ ok: false, reason: "unparseable" });
    expect(out).toBe(src);
  });

  it("an empty block is filled", async () => {
    const { result, out } = await run("---\n---\nBody\n");
    expect(result).toEqual({ ok: true, changed: true });
    expect(parseFrontmatter(out).order).toEqual(TEMPLATE_KEYS);
    expect(out.endsWith("---\nBody\n")).toBe(true);
  });
});
