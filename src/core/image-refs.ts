const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

// Inner ref of an image wikilink embed: strip alias/heading, keep the path.
function innerTarget(raw: string): string {
  return raw.split("|")[0].split("#")[0].trim();
}

// Combined pass so matches arrive in true document order: either a wikilink
// embed (group 1) or a markdown image link (group 2), never both.
const IMAGE_REF_RE = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;

export function extractImageRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ref: string): void => {
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  };

  for (const m of body.matchAll(IMAGE_REF_RE)) {
    if (m[1] !== undefined) {
      // Wikilink embed — only when the target has an image extension.
      const target = innerTarget(m[1]);
      if (IMAGE_EXT.test(target)) push(target);
    } else if (m[2] !== undefined) {
      // Markdown image link — always an image.
      push(m[2].trim());
    }
  }
  return out;
}

export function rewriteImageRefs(
  body: string,
  rewrites: Array<{ from: string; to: string }>
): string {
  const map = new Map(rewrites.map((r) => [r.from, r.to]));
  let out = body.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    // Split at the first '#' or '|' so the alias/heading/size suffix is
    // preserved verbatim on rewrite instead of being discarded.
    const splitIdx = inner.search(/[#|]/);
    const target = (splitIdx === -1 ? inner : inner.slice(0, splitIdx)).trim();
    const suffix = splitIdx === -1 ? "" : inner.slice(splitIdx);
    const to = map.get(target);
    return to ? `![[${to}${suffix}]]` : whole;
  });
  out = out.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, pre: string, url: string, post: string) => {
    const to = map.get(url.trim());
    return to ? `${pre}${to}${post}` : whole;
  });
  return out;
}
