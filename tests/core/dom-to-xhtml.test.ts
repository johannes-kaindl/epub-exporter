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

  it("degrades an unknown element to inline-safe text (no <p> wrapper) and reports it", () => {
    const onUnsupported = vi.fn();
    // unknown element sitting INSIDE a paragraph must NOT produce nested <p>
    const out = domToXhtml(frag("<p>a <foo>x</foo> b</p>"), ctx({ onUnsupported }));
    expect(out).toBe("<p>a x b</p>");
    expect(onUnsupported).toHaveBeenCalledWith("foo");
  });

  it("unwraps div/section/article without emitting the wrapper", () => {
    const out = domToXhtml(frag("<div><p>hi</p></div><section><p>yo</p></section>"), ctx());
    expect(out).toBe("<p>hi</p><p>yo</p>");
  });

  it("unwraps a callout div and reports it as unsupported", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(
      frag('<div class="callout"><div class="callout-title">Note</div><div class="callout-content"><p>body</p></div></div>'),
      ctx({ onUnsupported })
    );
    // callout box unwrapped: title text kept as unwrapped text, content <p> kept
    expect(out).toBe("Note<p>body</p>");
    expect(onUnsupported).toHaveBeenCalledWith("callout");
  });

  it("degrades a math container to text and reports it", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag("<mjx-container>x^2</mjx-container>"), ctx({ onUnsupported }));
    expect(out).toBe("x^2");
    expect(onUnsupported).toHaveBeenCalledWith("math");
  });

  it("keeps whitelisted attributes and drops the rest", () => {
    const out = domToXhtml(
      frag('<table><tbody><tr><td colspan="2" style="color:red" onclick="x()">c</td></tr></tbody></table>'),
      ctx()
    );
    expect(out).toBe('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>');
  });

  it("unwraps a <figure> and keeps its inner image", () => {
    const out = domToXhtml(
      frag('<figure><img src="a.png" alt="cap"><figcaption>cap</figcaption></figure>'),
      ctx()
    );
    expect(out).toContain('<img src="images/x.png" alt="cap"/>');
    expect(out).toContain("cap"); // figcaption text preserved as loose inline text
  });
});
