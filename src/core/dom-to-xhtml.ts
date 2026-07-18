export interface RenderContext {
  // EPUB href for an image src, or null to drop it (counts as unsupported).
  resolveImage(src: string): string | null;
  // Internal EPUB href (e.g. "chapter-03.xhtml") for a vault link target,
  // or null when the target is not part of this book (link -> plain text).
  resolveInternalLink(target: string): string | null;
  // Reports an element that was degraded (for the "N elements simplified" notice).
  onUnsupported(kind: string): void;
}

const VOID_TAGS = new Set(["br", "hr"]);
const PASSTHROUGH = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "em", "strong", "del", "s", "b", "i",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr", "br", "sup", "sub", "span", "div",
]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
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

  if (PASSTHROUGH.has(tag)) {
    if (VOID_TAGS.has(tag)) return `<${tag}/>`;
    return `<${tag}>${serializeChildren(el, ctx)}</${tag}>`;
  }

  // Unknown element (callout, math, embed container, ...) -> degrade to text.
  ctx.onUnsupported(tag);
  return `<p>${escapeText(el.textContent ?? "")}</p>`;
}
