import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile, TFolder, WorkspaceLeaf } from "../mocks/obsidian";
import EpubExporterPlugin from "../../src/main";
import { EpubHubView, VIEW_TYPE_EPUB_HUB, type SidebarBridge } from "../../src/obsidian/hub-view";
import { coerceSettings, toFolderBookOptions } from "../../src/obsidian/settings";
import { t } from "../../src/vendor/kit/i18n";

type Cb = (...args: unknown[]) => void;
// What the Plugin stand-in in tests/mocks/obsidian.ts keeps; the real Plugin type does not have it.
interface PluginStore { data: unknown; saveCalls: number }

// A vault the plugin can read, list, create folders in and copy files within: entries by path, folders know their children.
function makeVault(initial: { folders: string[]; files: string[] }) {
  const entries = new Map<string, TFile | TFolder>();
  const calls: string[] = [];
  const folderAt = (path: string): TFolder => {
    let f = entries.get(path);
    if (f instanceof TFolder) return f;
    const folder = Object.assign(new TFolder(), { path });
    entries.set(path, folder);
    if (path.includes("/")) folderAt(path.slice(0, path.lastIndexOf("/"))).children.push(folder);
    return folder;
  };
  const fileAt = (path: string): TFile => {
    const file = Object.assign(new TFile(), { path, basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""), extension: path.endsWith(".md") ? "md" : "png" });
    entries.set(path, file);
    if (path.includes("/")) folderAt(path.slice(0, path.lastIndexOf("/"))).children.push(file);
    return file;
  };
  for (const f of initial.folders) folderAt(f);
  for (const f of initial.files) fileAt(f);
  return {
    calls,
    remove: (path: string) => entries.delete(path),
    vault: {
      getAbstractFileByPath: (p: string) => entries.get(p) ?? null,
      getAllLoadedFiles: () => [...entries.values()],
      cachedRead: async () => "# Titel\n",
      createFolder: async (p: string) => { calls.push(`folder ${p}`); folderAt(p); },
      copy: async (file: TFile, to: string) => { calls.push(`copy ${file.path} -> ${to}`); fileAt(to); },
      on: () => ({}),
    },
  };
}

async function setup(opts: { folders?: string[]; files?: string[]; settings?: Record<string, unknown>; hubOpen?: boolean } = {}) {
  const fake = makeVault({
    folders: opts.folders ?? ["P", "P/docs", "P/docs/img"],
    files: opts.files ?? ["P/docs/README.md", "P/docs/a.md", "P/docs/img/x.png"],
  });
  const listeners = new Map<string, Cb>();
  const hubLeaves: Array<{ view: unknown }> = [];
  const rightLeaf = { setViewState: vi.fn(async () => {}) };
  const app = {
    vault: fake.vault,
    metadataCache: { getFileCache: (_file?: unknown): { frontmatter: Record<string, unknown> } => ({ frontmatter: {} }) },
    fileManager: {},
    workspace: {
      on: (name: string, cb: Cb) => { listeners.set(name, cb); return {}; },
      onLayoutReady: () => {},
      rootSplit: {},
      getMostRecentLeaf: () => null,
      getLeavesOfType: (type: string) => (type === VIEW_TYPE_EPUB_HUB ? hubLeaves : []),
      getRightLeaf: () => rightLeaf,
      revealLeaf: vi.fn(async () => {}),
    },
  };
  const plugin = new EpubExporterPlugin(app as unknown as App, {} as never);
  const store = plugin as unknown as PluginStore;
  store.data = opts.settings ?? null;
  await plugin.onload();

  // One open hub view, whose refresh() is observable.
  const bridge = (plugin as unknown as { makeBridge(): SidebarBridge }).makeBridge();
  const view = new EpubHubView(new WorkspaceLeaf() as never, bridge);
  const refresh = vi.spyOn(view, "refresh").mockResolvedValue();
  if (opts.hubOpen ?? true) hubLeaves.push({ view });

  const exportSource = vi.spyOn(plugin as unknown as { exportSource(s: unknown): Promise<void> }, "exportSource").mockResolvedValue();
  const importFolder = vi.spyOn(plugin as unknown as { importFolder(f: TFolder): Promise<void> }, "importFolder").mockResolvedValue();

  // The file menu of a folder or file, as Obsidian draws it: items with a title, an icon and a click.
  const openMenu = (file: unknown) => {
    const items: Array<{ title: string; icon: string; click: () => void }> = [];
    const menu = {
      addItem: (build: (item: unknown) => void) => {
        const item = { title: "", icon: "", click: () => {} };
        const api = {
          setTitle: (v: string) => { item.title = v; return api; },
          setIcon: (v: string) => { item.icon = v; return api; },
          onClick: (fn: () => void) => { item.click = fn; return api; },
        };
        build(api);
        items.push(item);
      },
    };
    listeners.get("file-menu")!(menu, file);
    return items;
  };
  const folderOf = (path: string) => fake.vault.getAbstractFileByPath(path) as TFolder;
  const handlers = () => bridge.handlers as Required<Pick<SidebarBridge["handlers"], "onFolderExport" | "onFolderToggleWorkCopy" | "onFolderCreateWorkCopy" | "onFolderImport" | "onFolderClose">>;
  return { plugin, store, fake, app, view, refresh, exportSource, importFolder, openMenu, folderOf, handlers, bridge, rightLeaf };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  Notice.shown.length = 0;
});

describe("Ordner-Rechtsklick", () => {
  it("offers exactly one entry, “Create EPUB”, and neither the old export nor the old import", async () => {
    const { openMenu, folderOf } = await setup();
    const items = openMenu(folderOf("P/docs"));
    expect(items.map((i) => i.title)).toEqual(["Create EPUB"]);
    expect(t("cmd.createEpub")).toBe("Create EPUB");
  });

  it("the click selects the folder and tells an open sidebar to show it", async () => {
    const { plugin, openMenu, folderOf, app, refresh, rightLeaf } = await setup();
    expect(plugin.folderSelection).toBeNull();
    openMenu(folderOf("P/docs"))[0].click();
    await tick();
    expect(plugin.folderSelection).toBe("P/docs");
    expect(app.workspace.revealLeaf).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(rightLeaf.setViewState).not.toHaveBeenCalled(); // reused, not opened a second time
  });

  it("the click opens the sidebar when it is not open yet", async () => {
    const { plugin, openMenu, folderOf, rightLeaf } = await setup({ hubOpen: false });
    openMenu(folderOf("P/docs"))[0].click();
    await tick();
    expect(plugin.folderSelection).toBe("P/docs");
    expect(rightLeaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPUB_HUB, active: true });
  });

  it("a second right-click on another folder switches the selection", async () => {
    const { plugin, openMenu, folderOf } = await setup({ folders: ["P", "P/docs", "P/other"], files: [] });
    openMenu(folderOf("P/docs"))[0].click();
    openMenu(folderOf("P/other"))[0].click();
    await tick();
    expect(plugin.folderSelection).toBe("P/other");
  });

  it("leaves the “Consolidate” entry of a book note alone and adds nothing to a plain note", async () => {
    const { openMenu, app } = await setup();
    const book = Object.assign(new TFile(), { path: "B.md", extension: "md" });
    const plain = Object.assign(new TFile(), { path: "N.md", extension: "md" });
    app.metadataCache.getFileCache = (f: unknown) => ({ frontmatter: f === book ? { epub: true } : {} }) as never;
    expect(openMenu(book).map((i) => i.title)).toEqual(["Consolidate book to folder"]);
    expect(openMenu(plain)).toEqual([]);
  });
});

describe("Sidebar im Ordnermodus: Export", () => {
  it("exports the selected folder with the folder options when no working copy is on", async () => {
    const { plugin, openMenu, folderOf, handlers, exportSource } = await setup({ settings: { folderNumberPrefix: true, folderIntroNames: "README" } });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderExport();
    expect(exportSource).toHaveBeenCalledTimes(1);
    expect(exportSource).toHaveBeenCalledWith({ kind: "folder", path: "P/docs", options: toFolderBookOptions(plugin.settings) });
    expect(toFolderBookOptions(plugin.settings)).toMatchObject({ numberPrefix: true, introNames: ["README"] });
  });

  it("exports the working copy when the switch is on and the copy is there", async () => {
    const { openMenu, folderOf, handlers, exportSource } = await setup({
      folders: ["P", "P/docs", "Arbeit", "Arbeit/P", "Arbeit/P/docs"],
      files: ["P/docs/a.md", "Arbeit/P/docs/b.md"],
      settings: { workDir: "Arbeit", useWorkCopy: true },
    });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderExport();
    expect(exportSource.mock.calls[0][0]).toMatchObject({ kind: "folder", path: "Arbeit/P/docs" });
  });

  it("exports the original while the switch is on but the copy does not exist yet", async () => {
    const { openMenu, folderOf, handlers, exportSource } = await setup({ settings: { workDir: "Arbeit", useWorkCopy: true } });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderExport();
    expect(exportSource.mock.calls[0][0]).toMatchObject({ path: "P/docs" });
  });

  it("exports the original while the copy exists but the switch is off", async () => {
    const { openMenu, folderOf, handlers, exportSource } = await setup({
      folders: ["P", "P/docs", "Arbeit", "Arbeit/P", "Arbeit/P/docs"],
      files: ["P/docs/a.md"],
      settings: { workDir: "Arbeit", useWorkCopy: false },
    });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderExport();
    expect(exportSource.mock.calls[0][0]).toMatchObject({ path: "P/docs" });
  });

  it("does nothing without a selection", async () => {
    const { handlers, exportSource } = await setup();
    handlers().onFolderExport();
    expect(exportSource).not.toHaveBeenCalled();
  });
});

describe("Sidebar im Ordnermodus: Arbeitskopie", () => {
  it("toggles useWorkCopy, saves it and redraws the sidebar, both ways", async () => {
    const { plugin, store, openMenu, folderOf, handlers, refresh } = await setup({ settings: { workDir: "Arbeit" } });
    openMenu(folderOf("P/docs"))[0].click();
    const saves = store.saveCalls;
    refresh.mockClear();
    handlers().onFolderToggleWorkCopy(); await tick();
    expect(plugin.settings.useWorkCopy).toBe(true);
    expect((store.data as { useWorkCopy: boolean }).useWorkCopy).toBe(true);
    expect(store.saveCalls).toBe(saves + 1);
    expect(refresh).toHaveBeenCalled();
    handlers().onFolderToggleWorkCopy(); await tick();
    expect(plugin.settings.useWorkCopy).toBe(false);
    expect((store.data as { useWorkCopy: boolean }).useWorkCopy).toBe(false);
  });

  it("creates the copy: ancestors and sub-folders first, every file, nothing from outside the folder", async () => {
    const { plugin, openMenu, folderOf, handlers, fake, refresh } = await setup({
      files: ["P/docs/README.md", "P/docs/a.md", "P/docs/img/x.png", "P/other.md"],
      settings: { workDir: "Arbeit", useWorkCopy: true },
    });
    openMenu(folderOf("P/docs"))[0].click();
    refresh.mockClear();
    handlers().onFolderCreateWorkCopy(); await tick();
    expect(fake.calls).toEqual([
      "folder Arbeit",
      "folder Arbeit/P",
      "folder Arbeit/P/docs",
      "folder Arbeit/P/docs/img",
      "copy P/docs/README.md -> Arbeit/P/docs/README.md",
      "copy P/docs/a.md -> Arbeit/P/docs/a.md",
      "copy P/docs/img/x.png -> Arbeit/P/docs/img/x.png",
    ]);
    expect(Notice.shown).toEqual([t("notice.workCopyCreated", "Arbeit/P/docs")]);
    expect(refresh).toHaveBeenCalled();
    expect(plugin.folderSelection).toBe("P/docs");
  });

  it("never overwrites: a second run touches nothing and says the copy exists", async () => {
    const { openMenu, folderOf, handlers, fake } = await setup({ settings: { workDir: "Arbeit", useWorkCopy: true } });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderCreateWorkCopy(); await tick();
    const after = fake.calls.length;
    Notice.shown.length = 0;
    handlers().onFolderCreateWorkCopy(); await tick();
    expect(fake.calls.length).toBe(after);
    expect(Notice.shown).toEqual([t("notice.workCopyExists", "Arbeit/P/docs")]);
  });

  it.each([
    ["the working directory lies inside the folder", { workDir: "P/docs/Arbeit" }, "view.folder.copyNo.containsWorkdir"],
    ["the folder is the working directory", { workDir: "P/docs" }, "view.folder.copyNo.insideWorkdir"],
    ["there is no working directory", {}, "view.folder.copyNo.noWorkdir"],
    ["the working directory leaves the vault", { workDir: "../x" }, "view.folder.copyNo.invalidWorkdir"],
  ])("shows the reason and creates nothing when %s", async (_what, settings, key) => {
    const { openMenu, folderOf, handlers, fake } = await setup({ settings });
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderCreateWorkCopy(); await tick();
    expect(fake.calls).toEqual([]);
    expect(Notice.shown).toEqual([t(key)]);
  });

  it("reports a copy that fails half-way instead of leaving the click unanswered", async () => {
    const { openMenu, folderOf, handlers, fake } = await setup({ settings: { workDir: "Arbeit" } });
    fake.vault.copy = async () => { throw new Error("disk full"); };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderCreateWorkCopy(); await tick();
    expect(Notice.shown).toEqual([t("notice.workCopyFailed")]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("Sidebar im Ordnermodus: Import und Schließen", () => {
  it("import creates the book note in the selected folder", async () => {
    const { openMenu, folderOf, handlers, importFolder } = await setup();
    openMenu(folderOf("P/docs"))[0].click();
    handlers().onFolderImport();
    expect(importFolder).toHaveBeenCalledTimes(1);
    expect(importFolder.mock.calls[0][0].path).toBe("P/docs");
  });

  it("import does nothing without a selection", async () => {
    const { handlers, importFolder } = await setup();
    handlers().onFolderImport();
    expect(importFolder).not.toHaveBeenCalled();
  });

  it("close clears the selection and redraws", async () => {
    const { plugin, openMenu, folderOf, handlers, refresh } = await setup();
    openMenu(folderOf("P/docs"))[0].click();
    refresh.mockClear();
    handlers().onFolderClose(); await tick();
    expect(plugin.folderSelection).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("Sidebar im Ordnermodus: Snapshot und Ereignisse", () => {
  it("shows the folder snapshot while a folder is selected, and the normal context otherwise", async () => {
    const { plugin, bridge, openMenu, folderOf } = await setup();
    expect(await bridge.snapshot()).toBeNull(); // no active note in this fake: the normal context is "none"
    openMenu(folderOf("P/docs"))[0].click();
    const snap = await bridge.snapshot();
    expect(snap?.kind).toBe("folder");
    expect(snap?.title).toBe("docs");
    expect(plugin.folderSelection).toBe("P/docs");
  });

  it("falls back to the normal context and clears the selection when the folder is gone", async () => {
    const { plugin, bridge, openMenu, folderOf, fake } = await setup();
    openMenu(folderOf("P/docs"))[0].click();
    fake.remove("P/docs");
    expect(await bridge.snapshot()).toBeNull();
    expect(plugin.folderSelection).toBeNull();
    expect((await bridge.snapshot())?.kind ?? "normal").toBe("normal"); // and it stays out of the folder mode
  });

  it("switching the active note does not end the folder mode", async () => {
    const { plugin, bridge, openMenu, folderOf, app, view } = await setup();
    openMenu(folderOf("P/docs"))[0].click();
    app.workspace.getMostRecentLeaf = () => ({ view: { file: Object.assign(new TFile(), { path: "Other.md", basename: "Other" }) } }) as never;
    await (view as unknown as { rerender(): Promise<void> }).rerender();
    expect((await bridge.snapshot())?.kind).toBe("folder");
    expect(plugin.folderSelection).toBe("P/docs");
  });

  it("follows the selected folder and, with the copy on, the copy; nothing else", async () => {
    const { bridge, openMenu, folderOf, plugin } = await setup({ settings: { workDir: "Arbeit" } });
    expect(bridge.affectsFolder?.("P/docs/a.md")).toBe(false); // no selection, nothing to follow
    openMenu(folderOf("P/docs"))[0].click();
    const affects = (p: string) => bridge.affectsFolder!(p);
    expect(affects("P/docs")).toBe(true);
    expect(affects("P/docs/a.md")).toBe(true);
    expect(affects("P/docs/img/x.png")).toBe(true);
    expect(affects("Arbeit/P/docs")).toBe(true);
    expect(affects("Arbeit/P/docs/b.md")).toBe(true);
    expect(affects("P/docs2/a.md")).toBe(false); // a name that only starts the same
    expect(affects("P/other.md")).toBe(false);
    expect(affects("Arbeit/Q/c.md")).toBe(false);
    plugin.settings.workDir = "";
    expect(affects("Arbeit/P/docs/b.md")).toBe(false);
  });

  it("saving the settings redraws the open sidebar (a changed number rule shows in the preview)", async () => {
    const { plugin, refresh } = await setup();
    refresh.mockClear();
    await plugin.saveSettings();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
