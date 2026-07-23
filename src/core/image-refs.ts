const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

// Inner ref of an image wikilink embed: strip alias/heading, keep the path.
function innerTarget(raw: string): string {
  return raw.split("|")[0].split("#")[0].trim();
}

export function extractImageRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ref: string): void => {
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  };

  // Wikilink embeds: ![[ ... ]] — only when the target has an image extension.
  for (const m of body.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const target = innerTarget(m[1]);
    if (IMAGE_EXT.test(target)) push(target);
  }
  // Markdown image links: ![alt](url) — always an image.
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    push(m[1].trim());
  }
  return out;
}

export function rewriteImageRefs(
  body: string,
  rewrites: Array<{ from: string; to: string }>
): string {
  const map = new Map(rewrites.map((r) => [r.from, r.to]));
  let out = body.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const target = innerTarget(inner);
    const to = map.get(target);
    return to ? `![[${to}]]` : whole;
  });
  out = out.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, pre: string, url: string, post: string) => {
    const to = map.get(url.trim());
    return to ? `${pre}${to}${post}` : whole;
  });
  return out;
}
