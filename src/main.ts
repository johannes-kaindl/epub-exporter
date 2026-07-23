// src/main.ts
import { Plugin, Notice, TFile, TFolder, Menu, getLanguage, normalizePath, WorkspaceLeaf } from "obsidian";
import { assembleBook, BookSource } from "./obsidian/book-assembler";
import { buildEpub } from "./core/epub-builder";
import { createAssemblerDeps } from "./obsidian/deps";
import { writeEpub } from "./obsidian/output";
import { sanitizeBase } from "./core/output-path";
import { EpubSettingTab } from "./obsidian/settings-tab";
import { coerceSettings, EpubExporterSettings } from "./obsidian/settings";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import { EpubHubView, VIEW_TYPE_EPUB_HUB, resolveTargetFile, SidebarBridge } from "./obsidian/hub-view";
import { buildSnapshot } from "./obsidian/sidebar-bridge";
import { buildConsolidatePlan } from "./core/consolidate-plan";
import { createConsolidatePort, gatherConsolidateInput, executeConsolidatePlan, ConsolidatePort } from "./obsidian/consolidate";
import { createImportPort, folderMdBasenames, executeImport } from "./obsidian/import";
import { buildImportPlan } from "./core/import-plan";
import { ConsolidateModal } from "./obsidian/consolidate-modal";
import { reorderSpine } from "./core/spine-reorder";
import { BOOK_FRONTMATTER_TEMPLATE, isBookNote, splitFrontmatter } from "./core/frontmatter";

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

    this.addCommand({
      id: "consolidate-book",
      name: t("cmd.consolidate"),
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && f.extension === "md" &&
          isBookNote(this.app.metadataCache.getFileCache(f)?.frontmatter ?? {});
        if (ok && !checking) void this.consolidateBook(f);
        return ok;
      },
    });

    // Right-click a folder → export it as a book (filename-sorted spine) or import it
    // as one; right-click a book note → consolidate it into a folder.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.exportFolder")).setIcon("book").onClick(() => {
              void this.exportSource({ kind: "folder", path: file.path });
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("cmd.importFolder")).setIcon("book-plus").onClick(() => {
              void this.importFolder(file);
            })
          );
        }
        if (file instanceof TFile && file.extension === "md" &&
            isBookNote(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {})) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.consolidate")).setIcon("folder-input").onClick(() => {
              void this.consolidateBook(file);
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
    const raw: unknown = await this.loadData();
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
          // Array.isArray narrows via `arg is any[]` (lib.es5), which reintroduces
          // `any` into the spread; the explicit cast keeps the copy but restores
          // `unknown` so the assignment stays type-safe.
          if (fm[key] === undefined) fm[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
        }
      });
      new Notice(t("notice.fmAdded"));
    } catch (e) {
      console.error("EPUB Exporter: frontmatter insert failed", e);
      new Notice(t("notice.fmFailed"));
    }
  }

  // Prefix every port path with the parent dir, so the pure planner's `folderName`
  // stays parent-free. Source paths (copy/move source, copyBinary source) are already
  // absolute vault paths and must NOT be prefixed.
  private rootedPort(base: ConsolidatePort, parentDir: string): ConsolidatePort {
    const at = (p: string) => (parentDir ? `${parentDir}/${p}` : p);
    return {
      createFolder: (p) => base.createFolder(at(p)),
      readBody: (p) => base.readBody(at(p)),
      copyFile: (s, t2) => base.copyFile(s, at(t2)),
      moveFile: (s, t2) => base.moveFile(s, at(t2)),
      writeFile: (p, c) => base.writeFile(at(p), c),
      copyBinary: (s, t2) => base.copyBinary(s, at(t2)),
    };
  }

  // Gather for preview only, then open the modal. The preview is gathered in "none"
  // asset mode: folderName/chapterCount/collision don't depend on asset mode, so this
  // avoids reading every chapter body just to compute a preview. The chosen asset mode
  // from the modal changes what needs gathering (image refs are only collected in full
  // mode), so runConsolidate re-gathers with the confirmed choice.
  private async consolidateBook(file: TFile): Promise<void> {
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    if (!isBookNote(fm)) { new Notice(t("notice.notBookNote")); return; }

    const assetMode = this.settings.consolidateAssetMode;
    let gathered: Awaited<ReturnType<typeof gatherConsolidateInput>>;
    try {
      gathered = await gatherConsolidateInput(this.app, file, "none", this.settings.defaultLanguage);
    } catch (e) {
      console.error("EPUB Exporter: consolidate gather failed", e);
      new Notice(t("notice.notBookNote"));
      return;
    }
    const { input } = gathered;
    const plan = buildConsolidatePlan(input);

    const preview = {
      folderName: plan.folderName,
      chapterCount: plan.chapters.length,
      // The planner suffixes on collision, so a changed folder name means a sibling existed.
      collision: plan.folderName !== sanitizeBase(input.bookTitle),
      defaultChapterMode: this.settings.consolidateChapterMode,
      defaultAssetMode: assetMode,
    };

    new ConsolidateModal(this.app, preview, (mode, assets) => {
      void this.runConsolidate(file, mode, assets);
    }).open();
  }

  private async runConsolidate(
    file: TFile,
    mode: "copy" | "move",
    assets: "full" | "cover" | "none"
  ): Promise<void> {
    try {
      const { input, parentDir, frontmatterBlock, bookNoteSourcePath } =
        await gatherConsolidateInput(this.app, file, assets, this.settings.defaultLanguage);
      const plan = buildConsolidatePlan(input);
      const port = this.rootedPort(createConsolidatePort(this.app), parentDir);
      const res = await executeConsolidatePlan(port, plan, {
        mode, bookNoteSourcePath, bookNoteFrontmatter: frontmatterBlock,
      });
      const full = parentDir ? `${parentDir}/${plan.folderName}` : plan.folderName;
      if (res.errors.length) {
        console.error("EPUB Exporter: consolidate problems", res.errors);
        new Notice(t("notice.consolidateErrors", res.errors.length));
      } else {
        new Notice(t("notice.consolidated", full));
      }
      if (plan.skipped > 0) new Notice(t("notice.brokenEmbed", plan.skipped));
    } catch (e) {
      console.error("EPUB Exporter: consolidate failed", e);
      new Notice(t("notice.exportFailed"));
    }
  }

  private async importFolder(folder: TFolder): Promise<void> {
    const basenames = folderMdBasenames(this.app, folder.path);
    if (basenames.length === 0) { new Notice(t("notice.importEmpty")); return; }
    const plan = buildImportPlan(folder.name, basenames, this.settings.defaultLanguage);
    const res = await executeImport(createImportPort(this.app), folder.path, plan);
    if (!res.created) { new Notice(t("notice.importExists")); return; }
    new Notice(t("notice.imported", res.notePath));
    const created = this.app.vault.getAbstractFileByPath(res.notePath);
    if (created instanceof TFile) void this.app.workspace.getLeaf(false).openFile(created);
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
        onConsolidate: () => {
          const f = resolveTargetFile(this.app);
          if (f) void this.consolidateBook(f);
          else new Notice(t("notice.noActiveNote"));
        },
        onReorder: (from, to, expectedCount) => this.reorderChapters(from, to, expectedCount),
      },
    };
  }

  // Write the new chapter order straight into the book note's embed spine.
  // Atomic via vault.process: the note is typically open in the editor while the
  // user drags, so read-then-write would risk clobbering an edit made in between.
  private async reorderChapters(from: number, to: number, expectedCount: number): Promise<void> {
    const file = resolveTargetFile(this.app);
    if (!file) { new Notice(t("notice.noActiveNote")); return; }
    // The lock only defers rerender/reorder requests, not the resolve step
    // above — if the main-area note changed underneath a deferred request,
    // resolveTargetFile could hand back a different, non-book file. expectedCount
    // catches every case where the chapter counts differ, but a same-count
    // non-book file (or a book note whose frontmatter was stripped meanwhile)
    // would slip past that guard, so re-check the target is still a book note
    // right before the one write path that rewrites a user's note.
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    if (!isBookNote(fm)) { new Notice(t("notice.notBookNote")); return; }

    let conflict = false;
    try {
      await this.app.vault.process(file, (data) => {
        // Reset on every invocation: vault.process retries the callback on a
        // concurrent write, and the flag must describe only the final attempt —
        // not a stale conflict from an earlier retry that then succeeded.
        conflict = false;
        // Indices count chapters in the body only — a YAML block value could
        // otherwise contribute a line that looks exactly like an embed.
        const { head, body } = splitFrontmatter(data);
        const res = reorderSpine(body, from, to, expectedCount);
        if (res.ok) return head + res.body;
        if (res.reason === "conflict") conflict = true;
        return data; // noop and out-of-range leave the file untouched
      });
    } catch (e) {
      console.error("EPUB Exporter: chapter reorder failed", e);
      new Notice(t("notice.reorderFailed"));
      return;
    }
    if (conflict) new Notice(t("notice.reorderConflict"));
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
