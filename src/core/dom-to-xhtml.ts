import { escapeHtmlAttr, escapeHtmlText } from "../vendor/kit/html-escape";

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


function serializeAttrs(el: Element, tag: string): string {
  const allow = ATTR_WHITELIST[tag];
  if (!allow) return "";
  let out = "";
  for (const name of allow) {
    const v = el.getAttribute(name);
    if (v !== null) out += ` ${name}="${escapeHtmlAttr(v)}"`;
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
  if (node.nodeType === 3) return escapeHtmlText(node.textContent ?? ""); // text
  if (node.nodeType !== 1) return ""; // comment/other
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Task-list checkbox: the box carries the state (open or done), so it becomes a text box instead of vanishing.
  if (tag === "input" && el.getAttribute("type") === "checkbox") {
    const checked = el.hasAttribute("checked") || (el as HTMLInputElement).checked === true;
    return checked ? "\u2611 " : "\u2610 ";
  }
  // The icon in a callout's title is decoration (an SVG); the title text beside it stays.
  if (el.classList.contains("callout-icon")) return "";

  if (tag === "img") {
    const href = ctx.resolveImage(el.getAttribute("src") ?? "");
    if (href === null) {
      ctx.onUnsupported("image");
      return "";
    }
    const alt = el.getAttribute("alt") ?? "";
    return `<img src="${escapeHtmlAttr(href)}" alt="${escapeHtmlAttr(alt)}"/>`;
  }

  if (tag === "a") {
    const inner = serializeChildren(el, ctx);
    const target = el.getAttribute("data-href") ?? el.getAttribute("href") ?? "";
    // obsidian:// opens a note in Obsidian; in an e-reader it is a dead link, so keep the text only.
    if (/^obsidian:\/\//i.test(target)) {
      ctx.onUnsupported("obsidian-link");
      return inner;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith("mailto:")) {
      return `<a href="${escapeHtmlAttr(target)}">${inner}</a>`;
    }
    const internal = ctx.resolveInternalLink(target);
    return internal ? `<a href="${escapeHtmlAttr(internal)}">${inner}</a>` : inner;
  }

  // Math (MathJax container or an element flagged with the math class) -> text.
  if (tag === "mjx-container" || el.classList.contains("math")) {
    ctx.onUnsupported("math");
    return escapeHtmlText(el.textContent ?? "");
  }

  // A callout is a div. It stays recognisable as a blockquote (the e-reader sets it apart), its type survives as a class and its
  // title is a paragraph of its own; the count stays, because the coloured box is still lost.
  if (tag === "div" && el.classList.contains("callout")) {
    ctx.onUnsupported("callout");
    const type = el.getAttribute("data-callout") ?? "";
    // A plain word only: the value comes from the note and goes into an attribute.
    const cls = /^[a-z][a-z0-9-]*$/i.test(type) ? `callout callout-${type.toLowerCase()}` : "callout";
    return `<blockquote class="${cls}">${serializeChildren(el, ctx)}</blockquote>`;
  }
  if (tag === "div" && el.classList.contains("callout-title")) {
    const title = serializeChildren(el, ctx);
    return title.trim() === "" ? "" : `<p><strong>${title}</strong></p>`;
  }

  // Generic containers -> unwrap.
  if (UNWRAP.has(tag)) {
    return serializeChildren(el, ctx);
  }

  if (BLOCK.has(tag) || INLINE.has(tag)) {
    if (VOID.has(tag)) return `<${tag}/>`;
    // A note embed sits in a paragraph as a span with headings and paragraphs inside (p > span > h1): the reader rejects a block
    // inside p or inside an inline element, so such a wrapper is split around its block children instead of nesting them.
    if ((tag === "p" || INLINE.has(tag)) && emitsBlock(el)) return splitAroundBlocks(el, tag, ctx);
    return `<${tag}${serializeAttrs(el, tag)}>${serializeChildren(el, ctx)}</${tag}>`;
  }

  // Unknown element -> inline-safe escaped text (NO <p> wrapper -> no invalid nesting).
  ctx.onUnsupported(tag);
  return escapeHtmlText(el.textContent ?? "");
}

// Does this node come out of serializeNode as (or containing) a block element? Mirrors the branches above: unknown elements, math,
// images and checkboxes come out as text or inline markup; containers and inline wrappers pass their children's answer through.
function emitsBlock(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (el.classList.contains("callout-icon") || tag === "mjx-container" || el.classList.contains("math")) return false;
  if (tag === "div" && (el.classList.contains("callout") || el.classList.contains("callout-title"))) return true;
  if (BLOCK.has(tag)) return true;
  if (UNWRAP.has(tag) || INLINE.has(tag) || tag === "a") return Array.from(el.childNodes).some(emitsBlock);
  return false;
}

// Emits the block children as they are and wraps each run of inline content between them in its own copy of the wrapper
// (`tag`), so <p>a<span><h1>T</h1></span>b</p> becomes <p>a</p><h1>T</h1><p>b</p>. A run of only whitespace is dropped.
function splitAroundBlocks(el: Element, tag: string, ctx: RenderContext): string {
  const open = `<${tag}${serializeAttrs(el, tag)}>`;
  let out = "";
  let run = "";
  const flush = (): void => {
    if (run.trim() !== "") out += `${open}${run}</${tag}>`;
    run = "";
  };
  el.childNodes.forEach((child) => {
    if (emitsBlock(child)) {
      flush();
      out += serializeNode(child, ctx);
    } else {
      run += serializeNode(child, ctx);
    }
  });
  flush();
  return out;
}
