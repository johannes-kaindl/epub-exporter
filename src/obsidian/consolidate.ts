import { App, TFile, TFolder, normalizePath } from "obsidian";
import { ConsolidatePlan, ChapterMode, ConsolidateInput, AssetMode, ResolvedImageRef } from "../core/consolidate-plan";
import { extractImageRefs, rewriteImageRefs } from "../core/image-refs";
import { parseEmbedSpine } from "../core/spine-parser";
import { parseBookMetadata, isBookNote, stripFrontmatter } from "../core/frontmatter";

export interface ConsolidatePort {
  createFolder(path: string): Promise<void>;
  readBody(path: string): Promise<string>;
  copyFile(sourcePath: string, targetPath: string): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  copyBinary(sourcePath: string, targetPath: string): Promise<void>;
}

export interface ConsolidateContext {
  mode: ChapterMode;
  bookNoteSourcePath: string;
  bookNoteFrontmatter: string;
}

export interface ConsolidateResult {
  folderPath: string;
  chapterCount: number;
  assetCount: number;
  errors: string[];
}

// Rewrite the cover value inside a raw frontmatter block. Matches `cover:` (or its
// German alias `titelbild:`) and replaces the rest of the line with a quoted wikilink.
function applyCoverRewrite(fm: string, cover: string | null): string {
  if (!cover) return fm;
  const line = new RegExp(`^(\\s*(?:cover|titelbild)\\s*:).*$`, "mi");
  if (line.test(fm)) return fm.replace(line, `$1 "${cover}"`);
  // No cover key present: inject one before the closing fence.
  return fm.replace(/\n---\s*$/, `\ncover: "${cover}"\n---`);
}

export async function executeConsolidatePlan(
  port: ConsolidatePort,
  plan: ConsolidatePlan,
  ctx: ConsolidateContext
): Promise<ConsolidateResult> {
  const errors: string[] = [];
  const folder = plan.folderName;
  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  await run("create folder", () => port.createFolder(folder));
  if (plan.assets.length) await run("create _assets", () => port.createFolder(`${folder}/_assets`));

  let chapterCount = 0;
  for (const ch of plan.chapters) {
    const target = `${folder}/${ch.targetName}`;
    await run(`chapter ${ch.targetName}`, async () => {
      if (ctx.mode === "move") await port.moveFile(ch.sourcePath, target);
      else await port.copyFile(ch.sourcePath, target);
      if (ch.rewrites.length) {
        const body = await port.readBody(target);
        await port.writeFile(target, rewriteImageRefs(body, ch.rewrites));
      }
      chapterCount++;
    });
  }

  let assetCount = 0;
  for (const a of plan.assets) {
    await run(`asset ${a.targetName}`, async () => {
      await port.copyBinary(a.sourcePath, `${folder}/${a.targetName}`);
      assetCount++;
    });
  }

  await run("folder note", async () => {
    const fm = applyCoverRewrite(ctx.bookNoteFrontmatter, plan.coverRewrite);
    const content = fm ? `${fm}\n${plan.bookNoteBody}` : plan.bookNoteBody;
    const target = `${folder}/${plan.bookNoteName}`;
    if (ctx.mode === "move") await port.moveFile(ctx.bookNoteSourcePath, target);
    await port.writeFile(target, content);
  });

  return { folderPath: folder, chapterCount, assetCount, errors };
}

export function createConsolidatePort(app: App): ConsolidatePort {
  const a = app.vault.adapter;
  return {
    async createFolder(path) {
      if (!(await a.exists(normalizePath(path)))) await app.vault.createFolder(normalizePath(path));
    },
    async readBody(path) {
      const f = app.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? app.vault.read(f) : "";
    },
    async copyFile(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) await app.vault.copy(f, targetPath);
    },
    async moveFile(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) await app.fileManager.renameFile(f, targetPath);
    },
    async writeFile(path, content) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await app.vault.modify(f, content);
      else await app.vault.create(path, content);
    },
    async copyBinary(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) {
        const bytes = await app.vault.readBinary(f);
        await a.writeBinary(normalizePath(targetPath), bytes);
      }
    },
  };
}

export interface GatheredConsolidate {
  input: ConsolidateInput;
  parentDir: string;         // dir the folder is created in ("" = vault root)
  frontmatterBlock: string;
  bookNoteSourcePath: string;
}

// One spine entry, resolved against the vault: either a present chapter note
// (with its TFile kept alongside for the image-ref pass below) or a dangling
// link that `buildConsolidatePlan` will report as skipped.
interface ResolvedChapter {
  sourcePath: string | null;
  title: string;
  imageRefs: ResolvedImageRef[];
  dest: TFile | null;
}

// Read a book note and resolve everything the pure planner needs. Obsidian-only edge.
export async function gatherConsolidateInput(
  app: App,
  bookFile: TFile,
  assetMode: AssetMode,
  defaultLanguage: string
): Promise<GatheredConsolidate> {
  const content = await app.vault.read(bookFile);
  const fm = (app.metadataCache.getFileCache(bookFile)?.frontmatter ?? {}) as Record<string, unknown>;
  if (!isBookNote(fm)) {
    throw new Error(`${bookFile.path} is not a book note (missing "epub: true" frontmatter)`);
  }
  const body = stripFrontmatter(content);
  const frontmatterBlock = content.slice(0, content.length - body.length).trimEnd();

  const spine = parseEmbedSpine(body);
  const leadingProse = body
    .split(/\r?\n/)
    .filter((line) => !/^!\[\[[^\]]+\]\]$/.test(line.trim()))
    .join("\n")
    .trim();

  const chapters: ResolvedChapter[] = spine.map((entry) => {
    const dest = app.metadataCache.getFirstLinkpathDest(entry.target, bookFile.path);
    if (!(dest instanceof TFile) || dest.extension !== "md") {
      return { sourcePath: null, title: entry.target, imageRefs: [], dest: null };
    }
    const dfm = (app.metadataCache.getFileCache(dest)?.frontmatter ?? {}) as Record<string, unknown>;
    const ct = dfm["chapter_title"];
    const title = typeof ct === "string" && ct ? ct : dest.basename;
    return { sourcePath: dest.path, title, imageRefs: [], dest };
  });

  // For full mode, read each present chapter body and resolve image refs.
  if (assetMode === "full") {
    for (const c of chapters) {
      if (!c.sourcePath || !c.dest) continue;
      const cbody = stripFrontmatter(await app.vault.read(c.dest));
      c.imageRefs = extractImageRefs(cbody).map((raw) => {
        const dest = app.metadataCache.getFirstLinkpathDest(raw, c.sourcePath as string);
        return { raw, resolvedPath: dest instanceof TFile ? dest.path : null };
      });
    }
  }

  // Cover: resolve the frontmatter cover value to a vault path.
  let coverPath: string | null = null;
  if (assetMode !== "none") {
    const meta = parseBookMetadata(fm, { fallbackTitle: bookFile.basename, defaultLanguage });
    if (meta.coverImagePath) {
      const inner = meta.coverImagePath.replace(/!?\[\[([^\]]+)\]\]/, "$1").split("|")[0].split("#")[0].trim();
      const dest = app.metadataCache.getFirstLinkpathDest(inner, bookFile.path);
      coverPath = dest instanceof TFile ? dest.path : null;
    }
  }

  const parent = bookFile.parent && bookFile.parent.path !== "/" ? bookFile.parent.path : "";
  const siblings = bookFile.parent instanceof TFolder
    ? bookFile.parent.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .map((c) => c.name)
    : [];

  const bookTitle = parseBookMetadata(fm, { fallbackTitle: bookFile.basename, defaultLanguage }).title;

  const input: ConsolidateInput = {
    bookTitle,
    chapters: chapters.map((c) => ({ sourcePath: c.sourcePath, title: c.title, imageRefs: c.imageRefs })),
    leadingProse,
    coverPath,
    assetMode,
    existingFolderNames: siblings,
  };
  return { input, parentDir: parent, frontmatterBlock, bookNoteSourcePath: bookFile.path };
}
