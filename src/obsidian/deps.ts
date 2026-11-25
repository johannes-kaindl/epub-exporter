// src/obsidian/deps.ts
import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { withRenderedNote, type RenderNoteFinding, type RenderNoteOptions } from "../vendor/kit-obsidian/render-note";
import { AssemblerDeps, NoteData } from "./book-assembler";
import { ImageSource } from "../core/image-registry";
import { extractCodeBlocks } from "../core/code-blocks";
import { stripFrontmatter } from "../core/frontmatter";

/** Overrides for the kit renderer — tests pass a fake document and ports; the plugin passes nothing. */
export type RenderOverrides = Partial<Pick<RenderNoteOptions, "doc" | "ports" | "cacheTimeoutMs" | "settle">>;

export function createAssemblerDeps(app: App, renderOverrides: RenderOverrides = {}): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath, use) {
      // Pull fenced code out BEFORE rendering (other plugins' post-processors would
      // replace the <pre> with unrecoverable widget DOM); re-injected after dom-to-xhtml.
      const { markdown: stripped, codes } = extractCodeBlocks(markdown);
      // Kit renderer: host attached to the document (Mermaid and callout icons draw), deadline, settle rule,
      // and a wait for the metadata cache of section embeds (`![[X#Heading]]` right after X was created or changed).
      return withRenderedNote({ app, markdown: stripped, sourcePath, ...renderOverrides }, ({ root, findings }) =>
        use({ root, codes, findings }));
    },

    async readNote(path) {
      const file = app.vault.getFileByPath(path);
      if (!file || file.extension !== "md") return null;
      const content = await app.vault.cachedRead(file);
      const frontmatter = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
      const note: NoteData = {
        path: file.path,
        basename: file.basename,
        frontmatter,
        body: stripFrontmatter(content),
      };
      return note;
    },

    resolveNotePath(target, sourcePath) {
      const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      return dest ? dest.path : null;
    },

    async readImage(src, sourcePath): Promise<ImageSource | null> {
      // Normalise every src to a vault TFile so the ImageRegistry dedups on the resolved
      // path (Task 3): the cover arrives as a bare filename, inline images as an app:// URL.
      let dest: TAbstractFile | null = null;
      if (/^(app:|capacitor:|https?:|blob:|data:)/i.test(src)) {
        // Renderer resource URL → recover the file by its basename.
        const clean = decodeURIComponent(src.split("?")[0]);
        const base = clean.split("/").pop() ?? clean;
        dest = app.metadataCache.getFirstLinkpathDest(base, sourcePath);
      } else {
        const link = decodeURIComponent(src.replace(/^\.\//, ""));
        dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath)
          ?? app.vault.getFileByPath(normalizePath(link));
      }
      if (!(dest instanceof TFile)) return null;
      const buf = await app.vault.readBinary(dest);
      return { data: new Uint8Array(buf), path: dest.path };
    },

    async listFolderNotes(folderPath) {
      const folder = app.vault.getFolderByPath(folderPath);
      if (!folder) return [];
      const paths: string[] = [];
      const walk = (dir: TFolder): void => {
        for (const child of dir.children) {
          if (child instanceof TFolder) walk(child);
          else if (child instanceof TFile && child.extension === "md") paths.push(child.path);
        }
      };
      walk(folder);
      return paths;
    },
  };
}

/** The sentence for a kit render finding: key `finding.<code>` and arguments in the same order as hypertext-exporter (`translateRenderFinding`). */
export function renderFindingMessage(f: RenderNoteFinding, t: (key: string, ...args: (string | number)[]) => string): string {
  switch (f.kind) {
    case "render-timeout": return t("finding.render.timeout", f.ms);
    case "render-failed": return t("finding.render.failed", f.message);
    case "mermaid-missing": return t("finding.render.mermaid-missing", f.expected - f.drawn, f.expected);
    case "not-settled": return t("finding.render.placeholder", f.ms, f.placeholders);
    case "window-hidden": return t("finding.render.hidden-window");
    case "metadata-not-ready": return t("finding.render.metadata-not-ready", f.target, f.ms);
    case "embed-missing": return t("finding.embed.missing", f.target);
  }
}
