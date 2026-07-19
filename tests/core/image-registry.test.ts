import { describe, it, expect } from "vitest";
import { ImageRegistry, mediaTypeForPath, ImageSource } from "../../src/core/image-registry";

const bytes = (n: number) => new Uint8Array([n, n, n]);

function fakeRead(map: Record<string, { path: string; n: number }>) {
  return async (src: string): Promise<ImageSource | null> => {
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
    expect(await reg.resolve("a.png")).toEqual({ id: "img-01", href: "images/img-01.png" });
    expect(await reg.resolve("b.jpg")).toEqual({ id: "img-02", href: "images/img-02.jpg" });
    const imgs = reg.images();
    expect(imgs.map((i) => i.id)).toEqual(["img-01", "img-02"]);
    expect(imgs[0].mediaType).toBe("image/png");
    expect(Array.from(imgs[1].data)).toEqual([2, 2, 2]);
  });

  it("dedups a repeated src to the same href without adding a second asset", async () => {
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 } }));
    const first = await reg.resolve("a.png");
    const second = await reg.resolve("a.png");
    expect(second).toEqual(first);
    expect(reg.images()).toHaveLength(1);
  });

  it("returns null (and records nothing) when read fails or type is unknown", async () => {
    const reg = new ImageRegistry(fakeRead({ "x.txt": { path: "x.txt", n: 9 } }));
    expect(await reg.resolve("missing.png")).toBeNull();
    expect(await reg.resolve("x.txt")).toBeNull();
    expect(reg.images()).toHaveLength(0);
  });
});
