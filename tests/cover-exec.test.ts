import { describe, it, expect, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { setCoverPath } from "../src/core/frontmatter";
import { createCoverPort, generateCoverFor, type CoverPort } from "../src/obsidian/cover";
import type { ImageApi, ImageApiStatus } from "../src/core/image-api";

// The test mock of "obsidian" has no `normalizePath`; `createCoverPort` calls it on every path. Everything else stays the mock.
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  normalizePath: (p: string) => p,
}));

const caps = {
  negativePrompt: false,
  cfg: false,
  maxSteps: 4,
  fixedSize: null,
  sizes: null,
};

function status(over: Partial<ImageApiStatus> = {}): ImageApiStatus {
  return { apiVersion: 1, engine: "server", ready: true, reason: null, capabilities: caps, ...over };
}

class FakePort implements CoverPort {
  binaries = new Map<string, string>();
  frontmatter: string;
  existing: Set<string>;
  constructor(fm = "---\nepub: true\ntitle: Salt Marsh\n---", existing: string[] = []) {
    this.frontmatter = fm;
    this.existing = new Set(existing);
  }
  exists(path: string) { return this.existing.has(path); }
  async writeBinary(path: string, base64: string) {
    this.binaries.set(path, base64);
    this.existing.add(path);
  }
  async updateFrontmatter(_notePath: string, fn: (fm: string) => string) {
    this.frontmatter = fn(this.frontmatter);
  }
}

function api(over: Partial<ImageApi> = {}): ImageApi {
  return {
    apiVersion: 1,
    status: () => status(),
    generate: async () => ({ ok: true, image: { base64: "UE5H", params: { seed: 7 } } }),
    ...over,
  };
}

const input = { notePath: "Books/Salt Marsh.md", prompt: "a marsh at dusk", width: 832, height: 1216 };

describe("generateCoverFor", () => {
  it("writes the image beside the note and points cover: at it", async () => {
    const port = new FakePort();
    const res = await generateCoverFor(port, api(), input);

    expect(res.ok).toBe(true);
    expect(port.binaries.get("Books/Salt Marsh cover.png")).toBe("UE5H");
    expect(port.frontmatter).toContain('cover: "[[Books/Salt Marsh cover.png]]"');
  });

  it("does not write anything when the provider is not ready", async () => {
    // The expensive half of this operation is the generation; the damaging half
    // is the vault write. Neither may happen on a provider that said no.
    const port = new FakePort();
    let generated = false;
    const res = await generateCoverFor(
      port,
      api({
        status: () => status({ ready: false, reason: "no-gpu" }),
        generate: async () => { generated = true; return { ok: true, image: { base64: "x", params: { seed: 1 } } }; },
      }),
      input
    );

    expect(res.ok).toBe(false);
    expect(generated).toBe(false);
    expect(port.binaries.size).toBe(0);
    expect(port.frontmatter).not.toContain("cover:");
  });

  it("leaves the note untouched when generation fails", async () => {
    // A half-applied result is worse than none: a cover: key pointing at a file
    // that was never written breaks the export that used to work.
    const port = new FakePort();
    const res = await generateCoverFor(
      port,
      api({ generate: async () => ({ ok: false, reason: "failed", message: "backend said no" }) }),
      input
    );

    expect(res.ok).toBe(false);
    expect(port.binaries.size).toBe(0);
    expect(port.frontmatter).not.toContain("cover:");
  });

  it("picks a free filename instead of overwriting an existing image", async () => {
    const port = new FakePort(undefined, ["Books/Salt Marsh cover.png"]);
    const res = await generateCoverFor(port, api(), input);

    expect(res.ok).toBe(true);
    expect(port.binaries.has("Books/Salt Marsh cover.png")).toBe(false);
    expect(port.binaries.has("Books/Salt Marsh cover 2.png")).toBe(true);
  });

  it("works for a note at the vault root", async () => {
    const port = new FakePort();
    const res = await generateCoverFor(port, api(), { ...input, notePath: "Salt Marsh.md" });

    expect(res.ok).toBe(true);
    expect(port.binaries.has("Salt Marsh cover.png")).toBe(true);
  });
});

// The seam between the block and the body is written by the adapter, not by the kit: `createCoverPort().updateFrontmatter` takes the
// head apart, lets `fn` rewrite the block and puts the body back. A CRLF note must come out CRLF throughout.
describe("createCoverPort().updateFrontmatter — line ending of the seam", () => {
  const PATH = "Books/Salt Marsh.md";
  function fakeApp(content: string): { app: App; read: () => string } {
    const file = Object.assign(new TFile(), { path: PATH });
    let text = content;
    const vault = {
      getAbstractFileByPath: (p: string) => (p === PATH ? file : null),
      process: async (_f: TFile, fn: (data: string) => string) => {
        text = fn(text);
        return text;
      },
    };
    return { app: { vault } as unknown as App, read: () => text };
  }
  const lone = (s: string): number => (s.match(/(?<!\r)\n/g) ?? []).length;
  const run = async (content: string) => {
    const { app, read } = fakeApp(content);
    await createCoverPort(app).updateFrontmatter(PATH, (fm) => setCoverPath(fm, "Books/c.png"));
    return read();
  };

  it("a CRLF note (block and body) stays CRLF throughout", async () => {
    const out = await run("---\r\nepub: true\r\ntitle: Salt Marsh\r\n---\r\n# Salt\r\n![[01 - A]]\r\n");
    expect(out).toContain('cover: "[[Books/c.png]]"');
    expect(lone(out)).toBe(0);
    expect(out.endsWith("---\r\n# Salt\r\n![[01 - A]]\r\n")).toBe(true);
  });

  it("an LF note stays LF (counter-sample: the fix must not turn LF into CRLF)", async () => {
    const out = await run("---\nepub: true\ntitle: Salt Marsh\n---\n# Salt\n![[01 - A]]\n");
    expect(out).toContain('cover: "[[Books/c.png]]"');
    expect(out).not.toContain("\r");
    expect(out.endsWith("---\n# Salt\n![[01 - A]]\n")).toBe(true);
  });

  it("a note without a block is not touched", async () => {
    expect(await run("# Salt\r\ntext\r\n")).toBe("# Salt\r\ntext\r\n");
  });
});
