import { Book, Chapter, TocEntry } from "../core/model";
import { parseBookMetadata, isBookNote } from "../core/frontmatter";
import { parseEmbedSpine } from "../core/spine-parser";
import { buildBookTree, fileInputFromNote, flattenPages, type BookNode, type BookTree, type FolderBookOptions } from "../core/folder-tree";
import { createLinkResolver } from "../vendor/kit/link-resolver";
import { domToXhtml, RenderContext } from "../core/dom-to-xhtml";
import { ImageRegistry, ImageSource } from "../core/image-registry";
import { DEFAULT_BOOK_CSS } from "../core/epub-builder";
import { restoreCodeBlocks, ExtractedCode } from "../core/code-blocks";

export interface NoteData {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  body: string; // markdown, frontmatter already stripped
}

export interface RenderedNote {
  root: HTMLElement;
  dispose: () => void;
  codes: ExtractedCode[]; // fenced code pulled out before render, re-injected after dom-to-xhtml
}

// Injected Obsidian port bundle — real impl (app.*) is built in Plan 3.
export interface AssemblerDeps {
  renderMarkdown(markdown: string, sourcePath: string): Promise<RenderedNote>;
  readNote(path: string): Promise<NoteData | null>;
  resolveNotePath(target: string, sourcePath: string): string | null;
  readImage(target: string, sourcePath: string): Promise<ImageSource | null>;
  listFolderNotes(folderPath: string): Promise<string[]>;
}

export type BookSource =
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string; options: FolderBookOptions };

export interface AssembledBook {
  book: Book;
  simplifiedCount: number;
  missing: string[];
}

interface ChapterPlan {
  title: string;
  body: string; // markdown to render
  sourcePath: string;
}

/** The nested table of contents of a folder tree. `indexOf` gives the chapter index of a page path.
 *  A chapter's entry points at its intro page, or at its first page when it has none; the intro is not listed again as a child. */
function tocFromTree(tree: BookTree, indexOf: (path: string) => number): TocEntry[] {
  const firstPath = (node: BookNode): string => {
    if (node.kind === "page") return node.path;
    if (node.intro) return node.intro.path;
    return firstPath(node.children[0]);
  };
  const entry = (node: BookNode): TocEntry => ({
    title: node.title,
    chapterIndex: indexOf(firstPath(node)),
    children: node.kind === "chapter" ? node.children.map(entry) : [],
  });
  const toc: TocEntry[] = [];
  if (tree.intro) toc.push({ title: tree.intro.title, chapterIndex: indexOf(tree.intro.path), children: [] });
  for (const node of tree.children) toc.push(entry(node));
  return toc;
}

function basenameNoExt(path: string): string {
  return path.replace(/\.md$/i, "").split("/").pop() ?? path;
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
}

function linkKeysFor(path: string): string[] {
  const noExt = path.replace(/\.md$/i, "");
  return [noExt.toLowerCase(), basenameNoExt(path).toLowerCase()];
}

function normalizeLinkTarget(target: string): string {
  const t = target.split("|")[0].split("#")[0].replace(/\.md$/i, "").trim();
  return (t.split("/").pop() ?? t).toLowerCase();
}

function chapterTitle(note: NoteData): string {
  const ct = note.frontmatter["chapter_title"];
  if (typeof ct === "string" && ct) return ct;
  return note.basename;
}

// Strip a [[wikilink]] or ![[embed]] wrapper down to the inner target.
function unwrapLink(value: string): string {
  const m = value.match(/!?\[\[([^\]]+)\]\]/);
  const inner = m ? m[1] : value;
  return inner.split("|")[0].split("#")[0].trim();
}

export async function assembleBook(
  deps: AssemblerDeps,
  source: BookSource,
  opts: { defaultLanguage: string; rng?: () => number }
): Promise<AssembledBook> {
  const missing: string[] = [];
  let frontmatter: Record<string, unknown> = {};
  let fallbackTitle = "Untitled";
  const plans: ChapterPlan[] = [];
  let metadataSourcePath = source.path;

  let toc: TocEntry[] | undefined;
  let folderResolver: ((target: string, fromPath: string) => number | null) | null = null;

  if (source.kind === "folder") {
    const notes = new Map<string, NoteData>();
    for (const path of await deps.listFolderNotes(source.path)) {
      const note = await deps.readNote(path);
      if (note) notes.set(note.path, note);
      else missing.push(path);
    }
    const tree = buildBookTree(source.path, [...notes.values()].map(fileInputFromNote), source.options);
    const pages = flattenPages(tree);
    const indexByPath = new Map(pages.map((page, i) => [page.path, i]));
    fallbackTitle = tree.title;
    for (const page of pages) {
      plans.push({ title: page.title, body: notes.get(page.path)?.body ?? "", sourcePath: page.path });
    }
    toc = tocFromTree(tree, (path) => indexByPath.get(path) ?? 0);
    folderResolver = createLinkResolver(pages);
  } else {
    const root = await deps.readNote(source.path);
    if (!root) {
      throw new Error(`Cannot read note: ${source.path}`);
    }
    if (isBookNote(root.frontmatter)) {
      frontmatter = root.frontmatter;
      fallbackTitle = root.basename;
      metadataSourcePath = root.path;
      const spine = parseEmbedSpine(root.body);
      // leading prose = book-note body with the embed lines removed
      const prose = root.body
        .split(/\r?\n/)
        .filter((line) => !/^!\[\[[^\]]+\]\]$/.test(line.trim()))
        .join("\n")
        .trim();
      if (prose) {
        plans.push({ title: root.basename, body: prose, sourcePath: root.path });
      }
      for (const entry of spine) {
        const path = deps.resolveNotePath(entry.target, root.path);
        const note = path ? await deps.readNote(path) : null;
        if (!note) {
          missing.push(entry.target);
          continue;
        }
        if (note.frontmatter["epub_exclude"] === true) continue;
        plans.push({ title: chapterTitle(note), body: note.body, sourcePath: note.path });
      }
    } else {
      // single note
      frontmatter = root.frontmatter;
      fallbackTitle = root.basename;
      metadataSourcePath = root.path;
      plans.push({ title: chapterTitle(root), body: root.body, sourcePath: root.path });
    }
  }

  // Build the cross-chapter link map (path/basename -> chapter file).
  const linkMap = new Map<string, string>();
  plans.forEach((plan, i) => {
    for (const key of linkKeysFor(plan.sourcePath)) linkMap.set(key, chapterFileName(i));
  });

  const registry = new ImageRegistry((src, sourcePath) => deps.readImage(src, sourcePath));
  let simplifiedCount = 0;
  const chapters: Chapter[] = [];

  for (const plan of plans) {
    const rendered = await deps.renderMarkdown(plan.body, plan.sourcePath);
    try {
      // Pre-resolve images so resolveImage can be synchronous.
      const srcToHref = new Map<string, string | null>();
      const imgs = rendered.root.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        const src = imgs[i].getAttribute("src") ?? "";
        if (srcToHref.has(src)) continue;
        const resolved = await registry.resolve(src, plan.sourcePath);
        srcToHref.set(src, resolved ? resolved.href : null);
      }
      const ctx: RenderContext = {
        resolveImage: (src) => srcToHref.get(src) ?? null,
        resolveInternalLink: (target) => {
          if (folderResolver) {
            const hit = folderResolver(target, plan.sourcePath);
            return hit === null ? null : chapterFileName(hit);
          }
          return linkMap.get(normalizeLinkTarget(target)) ?? null;
        },
        onUnsupported: () => {
          simplifiedCount++;
        },
      };
      const xhtml = restoreCodeBlocks(domToXhtml(rendered.root, ctx), rendered.codes);
      chapters.push({ title: plan.title, xhtml, sourcePath: plan.sourcePath });
    } finally {
      rendered.dispose();
    }
  }

  const metadata = parseBookMetadata(frontmatter, {
    fallbackTitle,
    defaultLanguage: opts.defaultLanguage,
    rng: opts.rng,
  });

  // Cover: resolve the frontmatter cover image (if any) through the registry.
  let coverImageId: string | undefined;
  if (metadata.coverImagePath) {
    const coverSrc = unwrapLink(metadata.coverImagePath);
    const resolved = await registry.resolve(coverSrc, metadataSourcePath);
    if (resolved) coverImageId = resolved.id;
  }

  const book: Book = {
    metadata,
    chapters,
    ...(toc ? { toc } : {}),
    images: registry.images(),
    coverImageId,
    css: DEFAULT_BOOK_CSS,
  };

  return { book, simplifiedCount, missing };
}
