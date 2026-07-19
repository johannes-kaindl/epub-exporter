// src/obsidian/deps.ts
import { App, Component, MarkdownRenderer, TFile, TFolder, normalizePath } from "obsidian";
import { AssemblerDeps, NoteData } from "./book-assembler";
import { ImageSource } from "../core/image-registry";
import { extractCodeBlocks } from "../core/code-blocks";
import { stripFrontmatter } from "../core/frontmatter";

export function createAssemblerDeps(app: App): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      // Pull fenced code out BEFORE rendering (other plugins' post-processors would
      // replace the <pre> with unrecoverable widget DOM); re-injected after dom-to-xhtml.
      const { markdown: stripped, codes } = extractCodeBlocks(markdown);
      const root = createDiv();
      const comp = new Component();
      await MarkdownRenderer.render(app, stripped, root, sourcePath, comp);
      return { root, dispose: () => comp.unload(), codes };
    },

    async readNote(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") return null;
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
      let dest: TFile | null = null;
      if (/^(app:|capacitor:|https?:|blob:|data:)/i.test(src)) {
        // Renderer resource URL → recover the file by its basename.
        const clean = decodeURIComponent(src.split("?")[0]);
        const base = clean.split("/").pop() ?? clean;
        dest = app.metadataCache.getFirstLinkpathDest(base, sourcePath);
      } else {
        const link = decodeURIComponent(src.replace(/^\.\//, ""));
        dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath)
          ?? (app.vault.getAbstractFileByPath(normalizePath(link)) as TFile | null);
      }
      if (!(dest instanceof TFile)) return null;
      const buf = await app.vault.readBinary(dest);
      return { data: new Uint8Array(buf), path: dest.path };
    },

    async listFolderNotes(folderPath) {
      const folder = app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) return [];
      return folder.children
        .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
        .map((f) => f.path);
    },
  };
}
