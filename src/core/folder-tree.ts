import { firstHeadingText } from "../vendor/kit/heading-title";
import { compareOrderedNames, parseOrderedName, type OrderedName } from "../vendor/kit/name-order";

export interface FolderBookOptions {
  /** Read a number in front of a name as order (and `0` as "hide"); off = plain natural order of the full name. */
  numberPrefix: boolean;
  /** Names (without extension, case-insensitive, `{{folder_name}}` allowed) of the page that opens a chapter. */
  introNames: string[];
  /** A page's title is its first heading; off = its file name. */
  titleFromHeading: boolean;
}

/** What a folder export does without any setting: natural order of the full names, no intro page, title from the first heading. */
export const DEFAULT_FOLDER_OPTIONS: FolderBookOptions = { numberPrefix: false, introNames: [], titleFromHeading: true };

export interface FolderFileInput {
  path: string;
  /** `chapter_title` from the frontmatter, if a non-empty string. */
  chapterTitle: string | null;
  /** First heading of the body, as plain text. */
  headingTitle: string | null;
  /** `epub_exclude: true`. */
  excluded: boolean;
}

export interface PageNode {
  kind: "page";
  path: string;
  title: string;
}

export interface ChapterNode {
  kind: "chapter";
  title: string;
  folderPath: string;
  intro: PageNode | null;
  children: BookNode[];
}

export type BookNode = PageNode | ChapterNode;

export interface BookTree {
  title: string;
  intro: PageNode | null;
  children: BookNode[];
  /** Items hidden by the name rule (a hidden folder counts once, not per page). Excluded pages do not count. */
  hiddenCount: number;
}

interface Dir {
  name: string;
  path: string;
  files: FolderFileInput[];
  dirs: Map<string, Dir>;
}

interface Level {
  intro: PageNode | null;
  children: BookNode[];
  hidden: number;
}

/** One sortable item of a level: a page or a sub-folder, with its name parsed once. */
interface Entry {
  name: string;
  path: string;
  parsed: OrderedName;
  node: BookNode;
}

const FOLDER_NAME = "{{folder_name}}";

function stripMd(name: string): string | null {
  return /\.md$/i.test(name) ? name.slice(0, -3) : null;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function collectDirs(rootPath: string, files: readonly FolderFileInput[]): Dir {
  const root: Dir = { name: lastSegment(rootPath), path: rootPath, files: [], dirs: new Map() };
  const prefix = rootPath === "" ? "" : `${rootPath}/`;
  for (const file of files) {
    if (!file.path.startsWith(prefix) || stripMd(file.path) === null) continue;
    const segments = file.path.slice(prefix.length).split("/");
    segments.pop();
    let dir = root;
    for (const segment of segments) {
      let next = dir.dirs.get(segment);
      if (!next) {
        next = { name: segment, path: dir.path === "" ? segment : `${dir.path}/${segment}`, files: [], dirs: new Map() };
        dir.dirs.set(segment, next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  return root;
}

function titleOf(name: string, parsed: OrderedName, options: FolderBookOptions): string {
  return options.numberPrefix ? parsed.title : name;
}

function compareEntries(a: Entry, b: Entry, options: FolderBookOptions): number {
  const byName = options.numberPrefix
    ? compareOrderedNames(a.parsed, b.parsed)
    : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  if (byName !== 0) return byName;
  // Same name for a page and a folder, or only the case differs: fall back to the path so the order does not depend on input order.
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function buildLevel(dir: Dir, folderTitle: string, options: FolderBookOptions): Level {
  let hidden = 0;
  const entries: Entry[] = [];

  for (const file of dir.files) {
    if (file.excluded) continue;
    const name = stripMd(lastSegment(file.path)) ?? "";
    const parsed = parseOrderedName(name);
    if (options.numberPrefix && parsed.hidden) {
      hidden++;
      continue;
    }
    const title = file.chapterTitle ?? (options.titleFromHeading && file.headingTitle ? file.headingTitle : titleOf(name, parsed, options));
    entries.push({ name, path: file.path, parsed, node: { kind: "page", path: file.path, title } });
  }

  for (const sub of dir.dirs.values()) {
    const parsed = parseOrderedName(sub.name);
    if (options.numberPrefix && parsed.hidden) {
      hidden++;
      continue;
    }
    const title = titleOf(sub.name, parsed, options);
    const level = buildLevel(sub, title, options);
    hidden += level.hidden;
    // A folder with nothing left to show is not a chapter.
    if (level.intro === null && level.children.length === 0) continue;
    entries.push({
      name: sub.name,
      path: sub.path,
      parsed,
      node: { kind: "chapter", title, folderPath: sub.path, intro: level.intro, children: level.children },
    });
  }

  entries.sort((a, b) => compareEntries(a, b, options));

  // The intro is the first page that matches a list entry, in list order, then in sort order.
  let intro: PageNode | null = null;
  for (const raw of options.introNames) {
    const wanted = raw.replaceAll(FOLDER_NAME, folderTitle).toLowerCase();
    const hit = entries.find((e) => e.node.kind === "page" && titleOf(e.name, e.parsed, options).toLowerCase() === wanted);
    if (hit) {
      intro = hit.node as PageNode;
      break;
    }
  }

  const children = entries.map((e) => e.node).filter((n) => n !== intro);
  return { intro, children, hidden };
}

/** Builds the book tree for a folder: every `.md` in `files` under `rootPath`, ordered and titled by the rules of the options.
 *  Folders come from the paths. */
export function buildBookTree(rootPath: string, files: readonly FolderFileInput[], options: FolderBookOptions): BookTree {
  const root = collectDirs(rootPath, files);
  const title = titleOf(root.name, parseOrderedName(root.name), options);
  const level = buildLevel(root, title, options);
  return { title, intro: level.intro, children: level.children, hiddenCount: level.hidden };
}

/** Reading order: the root intro first, then depth first with a chapter's intro before its children. */
export function flattenPages(tree: BookTree): PageNode[] {
  const pages: PageNode[] = [];
  if (tree.intro) pages.push(tree.intro);
  const walk = (nodes: readonly BookNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "page") {
        pages.push(node);
        continue;
      }
      if (node.intro) pages.push(node.intro);
      walk(node.children);
    }
  };
  walk(tree.children);
  return pages;
}

/** The input for one note: `chapter_title`, `epub_exclude: true` and the first heading of the body (no frontmatter). */
export function fileInputFromNote(note: { path: string; frontmatter: Record<string, unknown>; body: string }): FolderFileInput {
  const raw = note.frontmatter["chapter_title"];
  const chapterTitle = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  return {
    path: note.path,
    chapterTitle,
    headingTitle: firstHeadingText(note.body),
    excluded: note.frontmatter["epub_exclude"] === true,
  };
}
