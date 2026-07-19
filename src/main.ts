// src/main.ts
import { Plugin, Notice, TFile, TFolder, Menu, getLanguage, normalizePath, WorkspaceLeaf } from "obsidian";
import { assembleBook, BookSource } from "./obsidian/book-assembler";
import { buildEpub } from "./core/epub-builder";
import { createAssemblerDeps } from "./obsidian/deps";
import { writeEpub } from "./obsidian/output";
import { sanitizeBase } from "./core/output-path";
import { EpubSettingTab } from "./obsidian/settings-tab";
import { coerceSettings, EpubExporterSettings } from "./obsidian/settings";
import { BOOK_FRONTMATTER_TEMPLATE } from "./core/frontmatter";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import { EpubHubView, VIEW_TYPE_EPUB_HUB, resolveTargetFile, SidebarBridge } from "./obsidian/hub-view";
import { buildSnapshot } from "./obsidian/sidebar-bridge";

// Defensive feature-detect: getAvailablePathForAttachment is in the installed obsidian
// typings, but this narrow interface guards hosts older than minAppVersion (1.8.7),
// where the method may not exist at runtime.
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

    // Ribbon opens the sidebar (spec §5.1 "per Ribbon erreichbar", matching the
    // sibling hub plugins). Export lives on the command, the sidebar button, and
    // the folder context menu — the ribbon is the panel's entry point, not an export.
    this.addRibbonIcon("book", t("cmd.openSidebar"), () => { void this.openHub(); });

    this.addCommand({ id: "export-epub", name: t("cmd.export"), callback: () => { void this.exportActive(); } });
    this.addCommand({ id: "insert-book-frontmatter", name: t("cmd.insertFrontmatter"), callback: () => { void this.insertFrontmatterFor(this.app.workspace.getActiveFile()); } });

    this.registerView(VIEW_TYPE_EPUB_HUB, (leaf: WorkspaceLeaf) => new EpubHubView(leaf, this.makeBridge()));
    this.addCommand({ id: "open-sidebar", name: t("cmd.openSidebar"), callback: () => { void this.openHub(); } });

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

    // Gotcha Z.37: never auto-open unconditionally — gated on the setting and onLayoutReady.
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openSidebarOnStartup) void this.openHub();
    });
  }

  async loadSettings(): Promise<void> {
    const raw = await this.loadData();
    this.settings = coerceSettings(raw);
    // Fresh install (no persisted language yet): default the book language to
    // Obsidian's UI language (de/en) instead of the static "en" fallback. An
    // explicit user choice is preserved because its key is present in `raw`.
    const rawObj = (raw ?? {}) as Record<string, unknown>;
    if (rawObj.defaultLanguage === undefined) {
      this.settings.defaultLanguage = pickLang(readObsidianLocale());
    }
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
    const safeBaseName = sanitizeBase(baseName);
    const fm = this.app.fileManager as unknown as FileManagerExt;
    if (typeof fm.getAvailablePathForAttachment === "function") {
      return normalizePath(await fm.getAvailablePathForAttachment(`${safeBaseName}.epub`, sourcePath));
    }
    return normalizePath(`${safeBaseName}.epub`);
  }

  private async insertFrontmatterFor(file: TFile | null): Promise<void> {
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

  private makeBridge(): SidebarBridge {
    return {
      snapshot: () => buildSnapshot(this.app, this.settings.defaultLanguage),
      handlers: {
        onExport: () => {
          const file = resolveTargetFile(this.app);
          if (file) void this.exportSource({ kind: "note", path: file.path });
          else new Notice(t("notice.noActiveNote"));
        },
        onInsertFrontmatter: () => { void this.insertFrontmatterFor(resolveTargetFile(this.app)); },
      },
    };
  }

  async openHub(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_EPUB_HUB);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    if (existing.length === 0) await leaf.setViewState({ type: VIEW_TYPE_EPUB_HUB, active: true });
    void workspace.revealLeaf(leaf);
  }
}
