// vendored from code-kit@0.43.0, src/ts/pure/link-resolver.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Links between the pages of one document built from a folder tree (an EPUB, a PDF), resolved by the full path of the page and not
 *  by its file name. A folder tree has many pages called `README.md`; a lookup by file name sends every link `README.md` to the last
 *  one registered. Origin: epub-exporter "folder as book" (design 2026-10-27, § 5.6); paperize needs the same for a PDF with bookmarks.
 *  Pure, no I/O. */

import { resolveRelPath } from "./rel-path";

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

const MD_EXT = /\.md$/i;
const DOT_SEGMENT = /(^|[\\/])\.{1,2}($|[\\/])/;

/** The link text without alias (`|…`) and anchor (`#…`), URL-decoded when it can be, with `.md` appended; `null` if nothing is left. */
function cleanTarget(raw: string): string | null {
  let target = (raw.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
  try {
    target = decodeURIComponent(target);
  } catch {
    // A stray `%` is part of the name: keep the raw text.
  }
  target = target.trim();
  if (target === "") return null;
  return MD_EXT.test(target) ? target : `${target}.md`;
}

/** Resolves links between the pages of one book by the full vault path. For a link text and the vault path of the page that holds
 *  it, it answers the index of the target in `pages`, or `null` when the target is not a page of the book (hidden, excluded,
 *  another folder, ambiguous, not found, or a path that climbs out of the vault).
 *
 *  Order: relative to the folder of the linking page, then relative to the vault root, then — for a link without `.`/`..`
 *  segments — a file name or path tail that matches exactly one page (Obsidian's shortest-path wikilink). An explicitly relative
 *  link that misses is outside the book; it never falls back to a page of the same name elsewhere. Paths compare without case. */
export function createLinkResolver(pages: ReadonlyArray<{ path: string }>): (target: string, fromPath: string) => number | null {
  const byPath = new Map<string, number>();
  const byFileName = new Map<string, number[]>();
  pages.forEach((page, index) => {
    const lower = page.path.toLowerCase();
    if (!byPath.has(lower)) byPath.set(lower, index);
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    const same = byFileName.get(name);
    if (same) same.push(index);
    else byFileName.set(name, [index]);
  });

  return (target, fromPath) => {
    const text = cleanTarget(target);
    if (text === null) return null;

    const near = resolveRelPath(text.startsWith("/") ? "" : dirname(fromPath), text, { absolute: "strip" });
    // Leaving the vault, a NUL byte or nothing left: not a page of this book, and no exception.
    if (!near.ok) return null;
    const nearHit = byPath.get(near.path.toLowerCase());
    if (nearHit !== undefined) return nearHit;
    if (DOT_SEGMENT.test(text)) return null;

    const root = resolveRelPath("", text, { absolute: "strip" });
    if (!root.ok) return null;
    const rootPath = root.path.toLowerCase();
    const rootHit = byPath.get(rootPath);
    if (rootHit !== undefined) return rootHit;

    const candidates = (byFileName.get(rootPath.slice(rootPath.lastIndexOf("/") + 1)) ?? []).filter((i) =>
      (pages[i]?.path.toLowerCase().endsWith(`/${rootPath}`) ?? false),
    );
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  };
}
