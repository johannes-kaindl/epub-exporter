// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { domToXhtml, RenderContext } from "../../src/core/dom-to-xhtml";

function ctx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    resolveImage: () => "images/x.png",
    resolveInternalLink: () => null,
    onUnsupported: () => {},
    ...over,
  };
}

function frag(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

describe("domToXhtml", () => {
  it("passes through standard block/inline elements", () => {
    const out = domToXhtml(frag("<h1>T</h1><p>a <strong>b</strong> c</p>"), ctx());
    expect(out).toBe("<h1>T</h1><p>a <strong>b</strong> c</p>");
  });

  it("escapes text content", () => {
    const out = domToXhtml(frag("<p>a < b & c</p>"), ctx());
    expect(out).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("rewrites image src via resolveImage and self-closes", () => {
    const out = domToXhtml(
      frag('<img src="local.png" alt="cap">'),
      ctx({ resolveImage: () => "images/img-01.png" })
    );
    expect(out).toBe('<img src="images/img-01.png" alt="cap"/>');
  });

  it("drops an image and reports unsupported when resolveImage returns null", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag('<img src="x.png">'), ctx({ resolveImage: () => null, onUnsupported }));
    expect(out).toBe("");
    expect(onUnsupported).toHaveBeenCalledWith("image");
  });

  it("keeps external links, resolves internal links, and plain-texts unknown internal links", () => {
    const ext = domToXhtml(frag('<a href="https://x.com">go</a>'), ctx());
    expect(ext).toBe('<a href="https://x.com">go</a>');

    const internal = domToXhtml(
      frag('<a data-href="Chap2" href="Chap2">go</a>'),
      ctx({ resolveInternalLink: () => "chapter-02.xhtml" })
    );
    expect(internal).toBe('<a href="chapter-02.xhtml">go</a>');

    const dangling = domToXhtml(
      frag('<a data-href="Nope" href="Nope">go</a>'),
      ctx({ resolveInternalLink: () => null })
    );
    expect(dangling).toBe("go");
  });

  it("degrades an unsupported element to a text paragraph and reports it", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag("<math>E=mc2</math>"), ctx({ onUnsupported }));
    expect(out).toBe("<p>E=mc2</p>");
    expect(onUnsupported).toHaveBeenCalledWith("math");
  });
});
