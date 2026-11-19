const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

// Inner ref of an image wikilink embed: strip alias/heading, keep the path.
function innerTarget(raw: string): string {
  return raw.split("|")[0].split("#")[0].trim();
}

// One left-to-right pass finds both forms in true document order: a wikilink
// embed `![[inner]]` (inner: at least one character, no `]`) or a markdown
// image link `![alt](url)` (alt: no `]`; url: at least one character, no `)`).
//
// Hand-scanned instead of one regex because the regex form is quadratic on text
// with many openers and no closer (`![[![[![[…`, `![](![](…`): every opener
// rescans to the end of the text before it fails. `Finder` remembers the last
// hit, so a closer is searched for once however many openers precede it.
interface ImageRefHit {
  start: number;
  /** Index after the last character of the match. */
  end: number;
  kind: "embed" | "link";
  /** Embed: the text between `![[` and `]]`. Link: the url between `(` and `)`. */
  inner: string;
  /** Link only: `![alt](` — everything before the url. */
  pre: string;
}

/** Next index of `ch` at or after `from`; `from` never decreases between calls. */
class Finder {
  private last = -2;
  private from = 0;
  constructor(private readonly text: string, private readonly ch: string) {}
  next(from: number): number {
    if (this.last === -1 && from >= this.from) return -1;
    if (this.last >= from && from >= this.from) return this.last;
    this.from = from;
    this.last = this.text.indexOf(this.ch, from);
    return this.last;
  }
}

function* scanImageRefs(text: string, embeds: boolean, links: boolean): Generator<ImageRefHit> {
  const closeBracket = new Finder(text, "]");
  const closeParen = new Finder(text, ")");
  let p = text.indexOf("![");
  while (p !== -1) {
    let hit: ImageRefHit | null = null;
    if (embeds && text[p + 2] === "[") {
      // `text[p + 2]` is `[`, so the first `]` from `p + 2` is the first one from `p + 3`; same start keeps the Finder's queries ascending.
      const q = closeBracket.next(p + 2);
      if (q > p + 3 && text[q + 1] === "]") hit = { start: p, end: q + 2, kind: "embed", inner: text.slice(p + 3, q), pre: "" };
    }
    if (hit === null && links) {
      const r = closeBracket.next(p + 2);
      if (r !== -1 && text[r + 1] === "(") {
        const s = closeParen.next(r + 2);
        if (s > r + 2) hit = { start: p, end: s + 1, kind: "link", inner: text.slice(r + 2, s), pre: text.slice(p, r + 2) };
      }
    }
    if (hit === null) {
      p = text.indexOf("![", p + 1);
    } else {
      yield hit;
      p = text.indexOf("![", hit.end);
    }
  }
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

  for (const hit of scanImageRefs(body, true, true)) {
    if (hit.kind === "embed") {
      // Wikilink embed — only when the target has an image extension.
      const target = innerTarget(hit.inner);
      if (IMAGE_EXT.test(target)) push(target);
    } else {
      // Markdown image link — always an image.
      push(hit.inner.trim());
    }
  }
  return out;
}

export function rewriteImageRefs(
  body: string,
  rewrites: Array<{ from: string; to: string }>
): string {
  const map = new Map(rewrites.map((r) => [r.from, r.to]));
  const replaceHits = (text: string, embeds: boolean, links: boolean, make: (hit: ImageRefHit) => string): string => {
    let out = "";
    let at = 0;
    for (const hit of scanImageRefs(text, embeds, links)) {
      out += text.slice(at, hit.start) + make(hit);
      at = hit.end;
    }
    return out + text.slice(at);
  };
  const whole = (hit: ImageRefHit, text: string): string => text.slice(hit.start, hit.end);
  let out = replaceHits(body, true, false, (hit) => {
    // Split at the first '#' or '|' so the alias/heading/size suffix is
    // preserved verbatim on rewrite instead of being discarded.
    const splitIdx = hit.inner.search(/[#|]/);
    const target = (splitIdx === -1 ? hit.inner : hit.inner.slice(0, splitIdx)).trim();
    const suffix = splitIdx === -1 ? "" : hit.inner.slice(splitIdx);
    const to = map.get(target);
    return to ? `![[${to}${suffix}]]` : whole(hit, body);
  });
  const first = out;
  out = replaceHits(first, false, true, (hit) => {
    const to = map.get(hit.inner.trim());
    return to ? `${hit.pre}${to})` : whole(hit, first);
  });
  return out;
}
