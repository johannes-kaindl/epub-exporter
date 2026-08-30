import { describe, it, expect } from "vitest";
import { generateCoverFor, type CoverPort } from "../src/obsidian/cover";
import type { ImageApi, ImageApiStatus } from "../src/core/image-api";

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
