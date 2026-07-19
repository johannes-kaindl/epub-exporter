import { App, TFile } from "obsidian";
import { SidebarSnapshot, buildBookChapters } from "../core/sidebar-model";
import { isBookNote, parseBookMetadata, stripFrontmatter } from "../core/frontmatter";
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
      if (!(dest instanceof TFile)) return null;
      const destFm = (app.metadataCache.getFileCache(dest)?.frontmatter ?? {}) as Record<string, unknown>;
      const ct = destFm["chapter_title"];
      return { title: typeof ct === "string" && ct ? ct : dest.basename };
    });
    const title = parseBookMetadata(fm, { fallbackTitle: file.basename, defaultLanguage }).title;
    return { kind: "book", title, chapters };
  }

  return { kind: "note", title: file.basename, chapters: [] };
}
