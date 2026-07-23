import { parseEmbedSpine } from "./spine-parser";

export type SidebarContext = "book" | "note" | "none";
export type ChapterStatus = "ok" | "missing";

export interface SidebarChapter {
  title: string;
  status: ChapterStatus;
}

// Everything the sidebar model needs, already gathered from Obsidian (Plan-4 shell).
// A folder is never a sidebar context (folders have no active file), so `kind`
// is only book/note/none.
export interface SidebarSnapshot {
  kind: "book" | "note" | "none";
  title: string;
  chapters: SidebarChapter[]; // empty unless kind === "book"
}

export interface SidebarModel {
  context: SidebarContext;
  title: string;
  chapters: SidebarChapter[];
  missingCount: number;
  // Reordering needs at least two chapters to mean anything; the renderer uses
  // this to decide whether rows get drag handles at all.
  canReorder: boolean;
}

// Mirror assembleBook's spine walk WITHOUT rendering: cheap enough to run on
// every active-leaf change. `epub_exclude` is intentionally NOT applied here —
// the sidebar shows the raw embed spine; exclusion is honored at export time.
export function buildBookChapters(
  body: string,
  resolve: (target: string) => { title: string } | null
): SidebarChapter[] {
  return parseEmbedSpine(body).map((entry) => {
    const hit = resolve(entry.target);
    return hit
      ? { title: hit.title, status: "ok" as const }
      : { title: entry.target, status: "missing" as const };
  });
}

export function buildSidebarModel(snap: SidebarSnapshot | null): SidebarModel {
  if (!snap || snap.kind === "none") {
    return { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false };
  }
  if (snap.kind === "note") {
    return { context: "note", title: snap.title, chapters: [], missingCount: 0, canReorder: false };
  }
  const missingCount = snap.chapters.filter((c) => c.status === "missing").length;
  return {
    context: "book",
    title: snap.title,
    chapters: snap.chapters,
    missingCount,
    canReorder: snap.chapters.length > 1,
  };
}
