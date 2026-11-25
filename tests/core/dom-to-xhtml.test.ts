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

  it("turns an obsidian:// link into plain text and counts it (a dead link in an e-reader)", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag('<p><a href="obsidian://open?vault=V&amp;file=Note">the note</a> and <a href="OBSIDIAN://open?file=X">shout</a></p>'), ctx({ onUnsupported }));
    expect(out).toBe("<p>the note and shout</p>");
    expect(onUnsupported).toHaveBeenCalledTimes(2);
    expect(onUnsupported).toHaveBeenCalledWith("obsidian-link");
  });

  it("keeps the state of a task-list checkbox as a text box (before: the <input> vanished, done and open looked alike)", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(
      frag('<ul><li><input type="checkbox" class="task-list-item-checkbox"> open</li><li><input type="checkbox" checked> done</li></ul>'),
      ctx({ onUnsupported })
    );
    expect(out).toBe("<ul><li>\u2610  open</li><li>\u2611  done</li></ul>");
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it("drops the decorative callout icon without counting it, but still counts the callout", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(
      frag('<div class="callout"><div class="callout-title"><div class="callout-icon"><svg></svg></div><div class="callout-title-inner">Note</div></div><div class="callout-content"><p>text</p></div></div>'),
      ctx({ onUnsupported })
    );
    expect(out).toBe('<blockquote class="callout"><p><strong>Note</strong></p><p>text</p></blockquote>');
    expect(onUnsupported.mock.calls.map((c) => c[0])).toEqual(["callout"]);
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

  it("sets a callout as a blockquote with its title as its own bold paragraph, and reports it", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(
      frag('<div class="callout"><div class="callout-title">Note</div><div class="callout-content"><p>body</p></div></div>'),
      ctx({ onUnsupported })
    );
    // the box is kept as a blockquote (the e-reader shows it set apart), the title is a paragraph of its own and not loose text
    expect(out).toBe('<blockquote class="callout"><p><strong>Note</strong></p><p>body</p></blockquote>');
    expect(onUnsupported).toHaveBeenCalledWith("callout");
  });

  it("keeps the callout type as a class, so the kind of callout survives", () => {
    const out = domToXhtml(
      frag('<div class="callout" data-callout="warning"><div class="callout-title"><div class="callout-title-inner">Careful</div></div><div class="callout-content"><p>x</p></div></div>'),
      ctx()
    );
    expect(out).toBe('<blockquote class="callout callout-warning"><p><strong>Careful</strong></p><p>x</p></blockquote>');
  });

  it("drops a type that is not a plain word instead of putting it into an attribute", () => {
    const out = domToXhtml(frag('<div class="callout" data-callout="a&quot; onclick=&quot;x"><div class="callout-content"><p>x</p></div></div>'), ctx());
    expect(out).toBe('<blockquote class="callout"><p>x</p></blockquote>');
  });

  it("does not emit an empty title paragraph", () => {
    const out = domToXhtml(frag('<div class="callout"><div class="callout-title"><div class="callout-icon"><svg></svg></div></div><div class="callout-content"><p>x</p></div></div>'), ctx());
    expect(out).toBe('<blockquote class="callout"><p>x</p></blockquote>');
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

// Content-model probe: the output parses as XML, and no block element sits inside p or inside an inline element (EPUBCheck RSC-005).
const PHRASING_ONLY = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "em", "strong", "del", "s", "b", "i", "code", "sup", "sub", "span"]);
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "hr"]);
function blockInPhrasing(xhtml: string): string[] {
  const doc = new DOMParser().parseFromString(`<body xmlns="http://www.w3.org/1999/xhtml">${xhtml}</body>`, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return ["parsererror"];
  const bad: string[] = [];
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    if (!BLOCKS.has(el.localName)) continue;
    for (let a = el.parentElement; a && a.localName !== "body"; a = a.parentElement) {
      if (PHRASING_ONLY.has(a.localName)) bad.push(`${a.localName}>${el.localName}`);
    }
  }
  return bad;
}

// Obsidian builds the DOM with createEl, so a div may sit inside a p; the HTML parser behind innerHTML would close the p first and
// hide the case. The fixtures go through the XML parser, which keeps the nesting as written.
function domOf(xhtml: string): Element {
  return new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div>`, "application/xhtml+xml").documentElement;
}

// Obsidian renders ![[Note]] in running text as a span.internal-embed inside the paragraph, with the note's blocks inside it.
const EMBED_IN_P =
  '<p>vor <span class="internal-embed markdown-embed inline-embed is-loaded" src="Teil 2"><div class="embed-title markdown-embed-title"></div>' +
  '<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer markdown-preview-section">' +
  '<div><h1 data-heading="Teil 2">Teil 2</h1></div><div><p>Text <em>kursiv</em></p></div></div></div></div>' +
  '<div class="markdown-embed-link"></div></span> nach</p>';

describe("domToXhtml — embedded note inside a paragraph", () => {
  it("splits p > span > h1 into sibling blocks instead of nesting them", () => {
    const out = domToXhtml(domOf(EMBED_IN_P), ctx());
    expect(out).toBe("<p>vor </p><h1>Teil 2</h1><p>Text <em>kursiv</em></p><p> nach</p>");
    expect(blockInPhrasing(out)).toEqual([]);
  });

  it("keeps a paragraph with only an embed free of empty wrappers", () => {
    const out = domToXhtml(domOf('<p><span class="internal-embed"><div class="markdown-embed-content"><h2>A</h2><p>b</p></div></span></p>'), ctx());
    expect(out).toBe("<h2>A</h2><p>b</p>");
  });

  it("splits an inline wrapper with a block inside even outside a paragraph", () => {
    const out = domToXhtml(domOf("<em>a<div><ul><li>x</li></ul></div>b</em>"), ctx());
    expect(out).toBe("<em>a</em><ul><li>x</li></ul><em>b</em>");
    expect(blockInPhrasing(out)).toEqual([]);
  });

  it("leaves an ordinary paragraph and an embed without blocks untouched", () => {
    const out = domToXhtml(domOf('<p>a <span class="internal-embed">Bild</span> b</p>'), ctx());
    expect(out).toBe("<p>a <span>Bild</span> b</p>");
  });

  it("counts a callout inside an embed as a block", () => {
    const out = domToXhtml(domOf('<p><span class="internal-embed"><div class="callout" data-callout="note"><div class="callout-title">T</div></div></span></p>'), ctx());
    expect(blockInPhrasing(out)).toEqual([]);
  });
});
