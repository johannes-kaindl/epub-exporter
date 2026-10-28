import { App, TFile } from "obsidian";
import { SidebarSnapshot, WorkCopyState, buildBookChapters, buildFolderRows } from "../core/sidebar-model";
import { isBookNote, parseBookMetadata, stripFrontmatter } from "../core/frontmatter";
import { buildBookTree, fileInputFromNote } from "../core/folder-tree";
import { workCopyPath } from "../core/work-copy";
import { createAssemblerDeps } from "./deps";
import { EpubExporterSettings, toFolderBookOptions } from "./settings";
import { resolveTargetFile } from "./hub-view";

// Read the current target note and, if it is a book note, resolve its embed
// spine into ok/missing chapters. Cheap: cachedRead + metadataCache lookups,
// no rendering. Returns null when there is no markdown target.
export async function buildSnapshot(app: App, defaultLanguage: string): Promise<SidebarSnapshot | null> {
  const file = resolveTargetFile(app);
  if (!file) return null;

  const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;

  if (isBookNote(fm)) {
    const content = await app.vault.cachedRead(file);
    const body = stripFrontmatter(content);
    const chapters = buildBookChapters(body, (target) => {
      const dest = app.metadataCache.getFirstLinkpathDest(target, file.path);
      if (!(dest instanceof TFile) || dest.extension !== "md") return null;
      const destFm = (app.metadataCache.getFileCache(dest)?.frontmatter ?? {}) as Record<string, unknown>;
      const ct = destFm["chapter_title"];
      return { title: typeof ct === "string" && ct ? ct : dest.basename };
    });
    const title = parseBookMetadata(fm, { fallbackTitle: file.basename, defaultLanguage }).title;
    return { kind: "book", title, chapters };
  }

  return { kind: "note", title: file.basename, chapters: [] };
}

/** Where a folder is read from and what its working copy is doing. The preview and the export both ask here, so what the
 *  panel shows is what the export reads: the copy while the switch is on and the copy exists, else the original. */
export function resolveFolderSource(app: App, folderPath: string, settings: EpubExporterSettings): { sourcePath: string; workCopy: WorkCopyState } {
  const copy = workCopyPath(settings.workDir, folderPath);
  const workCopy: WorkCopyState = copy.ok
    ? { available: true, enabled: settings.useWorkCopy, path: copy.path, exists: app.vault.getAbstractFileByPath(copy.path) !== null }
    : { available: false, reason: copy.reason };
  const sourcePath = workCopy.available && workCopy.enabled && workCopy.exists ? workCopy.path : folderPath;
  return { sourcePath, workCopy };
}

// The folder preview: the book tree of a right-clicked folder, built from the very reads the export makes
// (`listFolderNotes`, `readNote`, `buildBookTree`), so the rows are the table of contents the export will write.
// With the working copy on and made, the copy is what is read, as it will be for the export; `sourcePath` says which.
export async function buildFolderSnapshot(app: App, folderPath: string, settings: EpubExporterSettings): Promise<SidebarSnapshot> {
  const { sourcePath, workCopy } = resolveFolderSource(app, folderPath, settings);

  const deps = createAssemblerDeps(app);
  const files = [];
  for (const path of await deps.listFolderNotes(sourcePath)) {
    // An unreadable note is left out of the preview; the export reports it as missing.
    const note = await deps.readNote(path);
    if (note) files.push(fileInputFromNote(note));
  }
  const tree = buildBookTree(sourcePath, files, toFolderBookOptions(settings));
  return {
    kind: "folder",
    title: tree.title,
    chapters: [],
    folder: { rows: buildFolderRows(tree), hiddenCount: tree.hiddenCount, sourcePath, workCopy },
  };
}
