import { describe, it, expect } from "vitest";
import { ImageRegistry, mediaTypeForPath, ImageSource } from "../../src/core/image-registry";

const bytes = (n: number) => new Uint8Array([n, n, n]);

function fakeRead(map: Record<string, { path: string; n: number }>, calls?: Array<{ src: string; sourcePath: string }>) {
  return async (src: string, sourcePath: string): Promise<ImageSource | null> => {
    calls?.push({ src, sourcePath });
    const hit = map[src];
    return hit ? { data: bytes(hit.n), path: hit.path } : null;
  };
}

describe("mediaTypeForPath", () => {
  it("maps known extensions and rejects unknown", () => {
    expect(mediaTypeForPath("a/b.png")).toBe("image/png");
    expect(mediaTypeForPath("c.JPG")).toBe("image/jpeg");
    expect(mediaTypeForPath("d.svg")).toBe("image/svg+xml");
    expect(mediaTypeForPath("e.txt")).toBeNull();
  });
});

describe("ImageRegistry", () => {
  it("assigns sequential ids and hrefs and records assets", async () => {
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 }, "b.jpg": { path: "img/b.jpg", n: 2 } }));
    expect(await reg.resolve("a.png", "note.md")).toEqual({ id: "img-01", href: "images/img-01.png" });
    expect(await reg.resolve("b.jpg", "note.md")).toEqual({ id: "img-02", href: "images/img-02.jpg" });
    const imgs = reg.images();
    expect(imgs.map((i) => i.id)).toEqual(["img-01", "img-02"]);
    expect(imgs[0].mediaType).toBe("image/png");
    expect(Array.from(imgs[1].data)).toEqual([2, 2, 2]);
  });

  it("dedups a repeated src to the same href without adding a second asset", async () => {
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 } }));
    const first = await reg.resolve("a.png", "note.md");
    const second = await reg.resolve("a.png", "note.md");
    expect(second).toEqual(first);
    expect(reg.images()).toHaveLength(1);
  });

  it("returns null (and records nothing) when read fails or type is unknown", async () => {
    const reg = new ImageRegistry(fakeRead({ "x.txt": { path: "x.txt", n: 9 } }));
    expect(await reg.resolve("missing.png", "note.md")).toBeNull();
    expect(await reg.resolve("x.txt", "note.md")).toBeNull();
    expect(reg.images()).toHaveLength(0);
  });

  it("forwards the given sourcePath to read", async () => {
    const calls: Array<{ src: string; sourcePath: string }> = [];
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 } }, calls));
    await reg.resolve("a.png", "chapter-3.md");
    expect(calls).toEqual([{ src: "a.png", sourcePath: "chapter-3.md" }]);
  });

  it("dedups two different srcs that resolve to the same vault path", async () => {
    // "cov.png" (cover) and "app://host/cov.png?9" (inline) → same file "assets/cov.png".
    const reg = new ImageRegistry(async (src) => ({
      data: new Uint8Array([1]),
      path: "assets/cov.png",
    }));
    const a = await reg.resolve("cov.png", "Book.md");
    const b = await reg.resolve("app://host/cov.png?9", "Chapter.md");
    expect(a).not.toBeNull();
    expect(b).toEqual(a); // same id + href
    expect(reg.images()).toHaveLength(1);
  });
});
