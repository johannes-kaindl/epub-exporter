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

  it("returns refs in true document order for mixed embed types", () => {
    expect(extractImageRefs("![alt](x.png)\n![[y.png]]")).toEqual(["x.png", "y.png"]);
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

  it("preserves the size modifier on a rewritten wikilink embed", () => {
    const out = rewriteImageRefs("![[cover.png|300]]", [
      { from: "cover.png", to: "_assets/cover.png" },
    ]);
    expect(out).toBe("![[_assets/cover.png|300]]");
  });

  it("preserves the heading/fragment on a rewritten wikilink embed", () => {
    const out = rewriteImageRefs("![[a.png#frag]]", [
      { from: "a.png", to: "_assets/a.png" },
    ]);
    expect(out).toBe("![[_assets/a.png#frag]]");
  });
});

// Differential check against the regex form this module used before it was hand-scanned (the regex was quadratic on openers without closers).
// Same results on every short string over an alphabet that hits each branch, including the ones that fail halfway.
describe("scanner equals the former regex form", () => {
  const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
  const RE = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
  const oldExtract = (body: string): string[] => {
    const out: string[] = [];
    const push = (r: string): void => { if (r && !out.includes(r)) out.push(r); };
    for (const m of body.matchAll(RE)) {
      if (m[1] !== undefined) {
        const t = m[1].split("|")[0].split("#")[0].trim();
        if (IMAGE_EXT.test(t)) push(t);
      } else if (m[2] !== undefined) push(m[2].trim());
    }
    return out;
  };
  const oldRewrite = (body: string, map: Map<string, string>): string => {
    let out = body.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
      const i = inner.search(/[#|]/);
      const target = (i === -1 ? inner : inner.slice(0, i)).trim();
      const to = map.get(target);
      return to ? `![[${to}${i === -1 ? "" : inner.slice(i)}]]` : whole;
    });
    out = out.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, pre: string, url: string, post: string) => {
      const to = map.get(url.trim());
      return to ? `${pre}${to}${post}` : whole;
    });
    return out;
  };
  const pieces = ["![", "[", "]", "(", ")", "a.png", "b"];
  const map = new Map([["a.png", "z.png"], ["b", "y"]]);
  const rewrites = [{ from: "a.png", to: "z.png" }, { from: "b", to: "y" }];

  it("extractImageRefs and rewriteImageRefs agree on all strings of up to seven pieces", () => {
    let n = 0;
    const walk = (s: string, depth: number): void => {
      expect(extractImageRefs(s), JSON.stringify(s)).toEqual(oldExtract(s));
      expect(rewriteImageRefs(s, rewrites), JSON.stringify(s)).toBe(oldRewrite(s, map));
      n++;
      if (depth === 0) return;
      for (const p of pieces) walk(s + p, depth - 1);
    };
    walk("", 7);
    expect(n).toBeGreaterThan(800_000);
  }, 120_000);
});
