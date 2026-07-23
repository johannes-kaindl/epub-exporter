import { describe, it, expect } from "vitest";
import { extractImageRefs, rewriteImageRefs } from "../src/core/image-refs";

describe("extractImageRefs", () => {
  it("pulls wikilink image embeds but not note embeds", () => {
    const body = "![[cover.png]]\n![[Chapter One]]\ntext ![[deep/pic.jpg]] more";
    expect(extractImageRefs(body)).toEqual(["cover.png", "deep/pic.jpg"]);
  });

  it("pulls markdown image links", () => {
    expect(extractImageRefs("![alt](assets/x.webp)")).toEqual(["assets/x.webp"]);
  });

  it("dedupes repeated refs, preserving first order", () => {
    expect(extractImageRefs("![[a.png]] ![[a.png]] ![[b.gif]]")).toEqual(["a.png", "b.gif"]);
  });

  it("ignores non-image wikilink embeds", () => {
    expect(extractImageRefs("![[note]] ![[data.csv]]")).toEqual([]);
  });
});

describe("rewriteImageRefs", () => {
  it("rewrites wikilink and markdown image refs", () => {
    const body = "![[cover.png]] and ![alt](sub/x.jpg)";
    const out = rewriteImageRefs(body, [
      { from: "cover.png", to: "_assets/cover.png" },
      { from: "sub/x.jpg", to: "_assets/x.jpg" },
    ]);
    expect(out).toBe("![[_assets/cover.png]] and ![alt](_assets/x.jpg)");
  });

  it("leaves refs without a matching rewrite untouched", () => {
    expect(rewriteImageRefs("![[a.png]]", [])).toBe("![[a.png]]");
  });
});
