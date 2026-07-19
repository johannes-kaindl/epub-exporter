// src/main.ts
import { Plugin, Notice, TFile, TFolder, Menu, getLanguage, normalizePath } from "obsidian";
import { assembleBook, BookSource } from "./obsidian/book-assembler";
import { buildEpub } from "./core/epub-builder";
import { createAssemblerDeps } from "./obsidian/deps";
import { writeEpub } from "./obsidian/output";
import { EpubSettingTab } from "./obsidian/settings-tab";
import { coerceSettings, EpubExporterSettings } from "./obsidian/settings";
import { BOOK_FRONTMATTER_TEMPLATE } from "./core/frontmatter";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";

// Runtime-only Obsidian API not in the public typings.
interface FileManagerExt {
  getAvailablePathForAttachment?: (filename: string, sourcePath: string) => Promise<string>;
}

function readObsidianLocale(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class EpubExporterPlugin extends Plugin {
  settings: EpubExporterSettings = coerceSettings(null);

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(readObsidianLocale()));
    await this.loadSettings();

    this.addSettingTab(new EpubSettingTab(this.app, this));

    this.addRibbonIcon("book", t("cmd.exportRibbon"), () => { void this.exportActive(); });

    this.addCommand({ id: "export-epub", name: t("cmd.export"), callback: () => { void this.exportActive(); } });
    this.addCommand({ id: "insert-book-frontmatter", name: t("cmd.insertFrontmatter"), callback: () => { void this.insertFrontmatter(); } });

    // Right-click a folder → export it as a book (filename-sorted spine).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.exportFolder")).setIcon("book").onClick(() => {
              void this.exportSource({ kind: "folder", path: file.path });
            })
          );
        }
      })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = coerceSettings(await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async exportActive(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
    await this.exportSource({ kind: "note", path: file.path });
  }

  private async exportSource(source: BookSource): Promise<void> {
    try {
      const deps = createAssemblerDeps(this.app);
      const { book, simplifiedCount, missing } = await assembleBook(deps, source, {
        defaultLanguage: this.settings.defaultLanguage,
      });
      if (book.chapters.length === 0) { new Notice(t("notice.noChapters")); return; }
      // Stamp the real modification time (EPUB3 dcterms:modified) — the engine leaves it to the plugin.
      book.metadata.modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

      const bytes = buildEpub(book);
      const { noteDir, baseName } = this.outputContextFor(source, book.metadata.title);
      const attachmentPath = this.settings.outputDestination === "attachmentFolder"
        ? await this.attachmentPathFor(source.path, baseName)
        : "";

      await writeEpub(this.app, bytes, this.settings.outputDestination, {
        baseName,
        noteDir,
        customFolder: this.settings.customFolder,
        attachmentPath,
      });

      if (missing.length > 0) new Notice(t("notice.brokenEmbed", missing.length));
      if (simplifiedCount > 0) new Notice(t("notice.simplified", simplifiedCount));
    } catch (e) {
      console.error("EPUB Exporter: export failed", e);
      new Notice(t("notice.exportFailed"));
    }
  }

  // The note directory + display base name for the output path.
  private outputContextFor(source: BookSource, title: string): { noteDir: string; baseName: string } {
    if (source.kind === "folder") {
      const slash = source.path.lastIndexOf("/");
      const parent = slash === -1 ? "" : source.path.slice(0, slash);
      return { noteDir: parent, baseName: title };
    }
    const file = this.app.vault.getAbstractFileByPath(source.path);
    const dir = file instanceof TFile && file.parent ? file.parent.path : "";
    return { noteDir: dir === "/" ? "" : dir, baseName: title };
  }

  private async attachmentPathFor(sourcePath: string, baseName: string): Promise<string> {
    const fm = this.app.fileManager as unknown as FileManagerExt;
    if (typeof fm.getAvailablePathForAttachment === "function") {
      return normalizePath(await fm.getAvailablePathForAttachment(`${baseName}.epub`, sourcePath));
    }
    return normalizePath(`${baseName}.epub`);
  }

  private async insertFrontmatter(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Add each template field only if absent — never overwrite user values.
        for (const [key, value] of Object.entries(BOOK_FRONTMATTER_TEMPLATE)) {
          if (fm[key] === undefined) fm[key] = Array.isArray(value) ? [...value] : value;
        }
      });
      new Notice(t("notice.fmAdded"));
    } catch (e) {
      console.error("EPUB Exporter: frontmatter insert failed", e);
      new Notice(t("notice.fmFailed"));
    }
  }
}
