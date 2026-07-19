export interface RenderContext {
  // EPUB href for an image src, or null to drop it (counts as unsupported).
  resolveImage(src: string): string | null;
  // Internal EPUB href (e.g. "chapter-03.xhtml") for a vault link target,
  // or null when the target is not part of this book (link -> plain text).
  resolveInternalLink(target: string): string | null;
  // Reports an element that was degraded (for the "N elements simplified" notice).
  onUnsupported(kind: string): void;
}

// Elements emitted verbatim (as valid XHTML tags).
const BLOCK = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "hr",
]);
const INLINE = new Set(["em", "strong", "del", "s", "b", "i", "code", "sup", "sub", "span", "br"]);
// Generic containers: unwrap (serialize children, drop the wrapper). Includes the common
// HTML5 sectioning/figure wrappers so a wrapped <img>/<a> is not lost to textContent.
const UNWRAP = new Set([
  "div", "section", "article",
  "figure", "figcaption", "aside", "details", "summary", "header", "footer", "main", "nav",
]);
const VOID = new Set(["br", "hr"]);
// Per-tag attribute whitelist — everything else is dropped for safety/validity.
const ATTR_WHITELIST: Record<string, string[]> = {
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
};

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function serializeAttrs(el: Element, tag: string): string {
  const allow = ATTR_WHITELIST[tag];
  if (!allow) return "";
  let out = "";
  for (const name of allow) {
    const v = el.getAttribute(name);
    if (v !== null) out += ` ${name}="${escapeAttr(v)}"`;
  }
  return out;
}

export function domToXhtml(root: Node, ctx: RenderContext): string {
  return serializeChildren(root, ctx);
}

function serializeChildren(node: Node, ctx: RenderContext): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += serializeNode(child, ctx);
  });
  return out;
}

function serializeNode(node: Node, ctx: RenderContext): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? ""); // text
  if (node.nodeType !== 1) return ""; // comment/other
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "img") {
    const href = ctx.resolveImage(el.getAttribute("src") ?? "");
    if (href === null) {
      ctx.onUnsupported("image");
      return "";
    }
    const alt = el.getAttribute("alt") ?? "";
    return `<img src="${escapeAttr(href)}" alt="${escapeAttr(alt)}"/>`;
  }

  if (tag === "a") {
    const inner = serializeChildren(el, ctx);
    const target = el.getAttribute("data-href") ?? el.getAttribute("href") ?? "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith("mailto:")) {
      return `<a href="${escapeAttr(target)}">${inner}</a>`;
    }
    const internal = ctx.resolveInternalLink(target);
    return internal ? `<a href="${escapeAttr(internal)}">${inner}</a>` : inner;
  }

  // Math (MathJax container or an element flagged with the math class) -> text.
  if (tag === "mjx-container" || el.classList.contains("math")) {
    ctx.onUnsupported("math");
    return escapeText(el.textContent ?? "");
  }

  // Generic containers -> unwrap. A callout is a div; flag it, then keep its inner content.
  if (UNWRAP.has(tag)) {
    if (el.classList.contains("callout")) ctx.onUnsupported("callout");
    return serializeChildren(el, ctx);
  }

  if (BLOCK.has(tag) || INLINE.has(tag)) {
    if (VOID.has(tag)) return `<${tag}/>`;
    return `<${tag}${serializeAttrs(el, tag)}>${serializeChildren(el, ctx)}</${tag}>`;
  }

  // Unknown element -> inline-safe escaped text (NO <p> wrapper -> no invalid nesting).
  ctx.onUnsupported(tag);
  return escapeText(el.textContent ?? "");
}
