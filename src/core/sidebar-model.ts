import { parseEmbedSpine } from "./spine-parser";
import type { BookNode, BookTree } from "./folder-tree";

export type SidebarContext = "book" | "note" | "folder" | "none";
export type ChapterStatus = "ok" | "missing";

export interface SidebarChapter {
  title: string;
  status: ChapterStatus;
}

/** One line of the folder preview: a chapter (folder) or a page, indented by its depth in the book. */
export interface FolderPreviewRow {
  title: string;
  depth: number;
  kind: "chapter" | "page";
}

/** Whether the folder can be worked on as a copy in the working directory, and where that stands. */
export type WorkCopyState =
  | { available: false; reason: "no-workdir" | "invalid-workdir" | "inside-workdir" | "contains-workdir" }
  | { available: true; enabled: boolean; path: string; exists: boolean };

export interface FolderPreview {
  rows: FolderPreviewRow[];
  /** Items the name rule hides (a hidden folder counts once). */
  hiddenCount: number;
  /** The vault folder the rows were read from: the original, or its working copy while that is on and exists. */
  sourcePath: string;
  workCopy: WorkCopyState;
}

// Everything the sidebar model needs, already gathered from Obsidian (Plan-4 shell).
// A folder has no active file, so the folder context comes from an explicit
// selection (right-click on a folder), not from the active leaf.
export interface SidebarSnapshot {
  kind: "book" | "note" | "folder" | "none";
  title: string;
  chapters: SidebarChapter[]; // empty unless kind === "book"
  folder?: FolderPreview; // only for kind === "folder"
}

export interface SidebarModel {
  context: SidebarContext;
  title: string;
  chapters: SidebarChapter[];
  missingCount: number;
  // Reordering needs at least two chapters to mean anything; the renderer uses
  // this to decide whether rows get drag handles at all.
  canReorder: boolean;
  // Whether an image provider is installed, enabled and reports itself usable.
  // Optional so existing callers and fixtures stay valid; absent means "no".
  canGenerateCover?: boolean;
  // Only in the folder context.
  folder?: FolderPreview;
}

/** The book tree as the table of contents will show it: the root intro first, a chapter before its children.
 *  A chapter's intro page is not a row of its own, the chapter's entry is that page. */
export function buildFolderRows(tree: BookTree): FolderPreviewRow[] {
  const rows: FolderPreviewRow[] = [];
  if (tree.intro) rows.push({ title: tree.intro.title, depth: 0, kind: "page" });
  const walk = (nodes: readonly BookNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind === "page") {
        rows.push({ title: node.title, depth, kind: "page" });
        continue;
      }
      rows.push({ title: node.title, depth, kind: "chapter" });
      walk(node.children, depth + 1);
    }
  };
  walk(tree.children, 0);
  return rows;
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

/** Runtime facts the snapshot cannot know, because they live outside the vault. */
export interface SidebarCapabilities {
  /** An image provider is installed, enabled and reports itself usable. */
  canGenerateCover: boolean;
}

export function buildSidebarModel(
  snap: SidebarSnapshot | null,
  caps?: SidebarCapabilities
): SidebarModel {
  if (!snap || snap.kind === "none") {
    return { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false, canGenerateCover: false };
  }
  if (snap.kind === "note") {
    return { context: "note", title: snap.title, chapters: [], missingCount: 0, canReorder: false, canGenerateCover: false };
  }
  if (snap.kind === "folder") {
    return {
      context: "folder",
      title: snap.title,
      chapters: [],
      missingCount: 0,
      canReorder: false,
      canGenerateCover: false,
      folder: snap.folder ?? { rows: [], hiddenCount: 0, sourcePath: "", workCopy: { available: false, reason: "no-workdir" } },
    };
  }
  const missingCount = snap.chapters.filter((c) => c.status === "missing").length;
  return {
    context: "book",
    title: snap.title,
    chapters: snap.chapters,
    missingCount,
    canReorder: snap.chapters.length > 1,
    // Absence of information is not permission: a caller that predates this
    // feature must not switch a button on by saying nothing.
    canGenerateCover: caps?.canGenerateCover ?? false,
  };
}
