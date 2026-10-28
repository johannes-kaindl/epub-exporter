import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "../mocks/obsidian";
import { buildFolderSnapshot } from "../../src/obsidian/sidebar-bridge";
import { buildSidebarModel } from "../../src/core/sidebar-model";
import { coerceSettings } from "../../src/obsidian/settings";

interface Note { body: string; fm?: Record<string, unknown> }

// A vault of notes (path → content) as the real classes see it: folders with children, files with a path.
function fakeApp(notes: Record<string, Note>, extraFolders: string[] = []): App {
  const folders = new Map<string, TFolder>();
  const entries = new Map<string, TFile | TFolder>();
  const folderAt = (path: string): TFolder => {
    let f = folders.get(path);
    if (!f) {
      f = new TFolder();
      f.path = path;
      folders.set(path, f);
      entries.set(path, f);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
      if (parent !== null) folderAt(parent).children.push(f);
    }
    return f;
  };
  for (const path of extraFolders) folderAt(path);
  for (const path of Object.keys(notes)) {
    const file = new TFile();
    file.path = path;
    file.basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    entries.set(path, file);
    folderAt(path.slice(0, path.lastIndexOf("/"))).children.push(file);
  }
  return {
    vault: {
      getAbstractFileByPath: (p: string) => entries.get(p) ?? null,
      cachedRead: async (f: TFile) => {
        const n = notes[f.path];
        const fm = n.fm ? `---\n${Object.entries(n.fm).map(([k, v]) => `${k}: ${String(v)}`).join("\n")}\n---\n` : "";
        return fm + n.body;
      },
    },
    metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: notes[f.path]?.fm }) },
  } as unknown as App;
}

const docs: Record<string, Note> = {
  "P/docs/README.md": { body: "# Überblick\n\ntext" },
  "P/docs/02 - Zweites.md": { body: "ohne Überschrift" },
  "P/docs/01 - Erstes.md": { body: "# Das Erste\n" },
  "P/docs/0 - Entwurf.md": { body: "# Geheim\n" },
  "P/docs/tutorials/lektion.md": { body: "# Lektion\n", fm: { chapter_title: "Lektion Eins" } },
  "P/docs/tutorials/aus.md": { body: "# Aus\n", fm: { epub_exclude: true } },
};

describe("buildFolderSnapshot", () => {
  const settings = (over: Record<string, unknown> = {}) => coerceSettings(over);
  const titles = (snap: Awaited<ReturnType<typeof buildFolderSnapshot>>) => snap.folder!.rows.map((r) => `${r.depth}${r.kind === "chapter" ? "/" : " "}${r.title}`);

  it("previews the folder the way the export reads it: natural order, heading or name as title, chapter_title wins, excluded pages gone", async () => {
    const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings());
    expect(snap.kind).toBe("folder");
    expect(snap.title).toBe("docs");
    expect(snap.folder!.sourcePath).toBe("P/docs");
    expect(snap.folder!.hiddenCount).toBe(0);
    expect(titles(snap)).toEqual(["0 Geheim", "0 Das Erste", "0 02 - Zweites", "0 Überblick", "0/tutorials", "1 Lektion Eins"]);
  });

  it("reads the number rule from the settings: a number sorts and loses its prefix, a 0 hides and is counted", async () => {
    const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ folderNumberPrefix: true }));
    expect(titles(snap)).toEqual(["0 Das Erste", "0 Zweites", "0 Überblick", "0/tutorials", "1 Lektion Eins"]);
    expect(snap.folder!.hiddenCount).toBe(1);
  });

  it("reads intro pages and the title source from the settings", async () => {
    const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ folderIntroNames: "README", folderPageTitle: "filename" }));
    // README is the root intro and comes first; titles are file names now (chapter_title still wins)
    expect(titles(snap)).toEqual(["0 README", "0 0 - Entwurf", "0 01 - Erstes", "0 02 - Zweites", "0/tutorials", "1 Lektion Eins"]);
  });

  it("feeds the model the way the view does", async () => {
    const model = buildSidebarModel(await buildFolderSnapshot(fakeApp(docs), "P/docs", settings()));
    expect(model.context).toBe("folder");
    expect(model.folder!.rows.length).toBe(6);
  });

  describe("working copy", () => {
    const withCopy: Record<string, Note> = {
      ...docs,
      "Arbeit/P/docs/umbenannt.md": { body: "# Nur in der Kopie\n" },
    };

    it("without a working directory: not available, the original is read", async () => {
      const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ useWorkCopy: true }));
      expect(snap.folder!.workCopy).toEqual({ available: false, reason: "no-workdir" });
      expect(snap.folder!.sourcePath).toBe("P/docs");
    });

    it("with a working directory but the switch off: available, off, original read, copy existence reported", async () => {
      const off = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ workDir: "Arbeit" }));
      expect(off.folder!.workCopy).toEqual({ available: true, enabled: false, path: "Arbeit/P/docs", exists: false });
      expect(off.folder!.sourcePath).toBe("P/docs");
      const offWithCopy = await buildFolderSnapshot(fakeApp(withCopy), "P/docs", settings({ workDir: "Arbeit" }));
      expect(offWithCopy.folder!.workCopy).toMatchObject({ enabled: false, exists: true });
      expect(offWithCopy.folder!.sourcePath).toBe("P/docs");
      expect(titles(offWithCopy)).not.toContain("0 Nur in der Kopie");
    });

    it("switch on and the copy there: preview and source are the copy, not the original", async () => {
      const snap = await buildFolderSnapshot(fakeApp(withCopy), "P/docs", settings({ workDir: "Arbeit", useWorkCopy: true }));
      expect(snap.folder!.workCopy).toEqual({ available: true, enabled: true, path: "Arbeit/P/docs", exists: true });
      expect(snap.folder!.sourcePath).toBe("Arbeit/P/docs");
      expect(titles(snap)).toEqual(["0 Nur in der Kopie"]);
      expect(snap.title).toBe("docs");
    });

    it("switch on but no copy yet: the original is still what is previewed, and the state says the copy is missing", async () => {
      const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ workDir: "Arbeit", useWorkCopy: true }));
      expect(snap.folder!.workCopy).toEqual({ available: true, enabled: true, path: "Arbeit/P/docs", exists: false });
      expect(snap.folder!.sourcePath).toBe("P/docs");
      expect(titles(snap)).toContain("0 Das Erste");
    });

    it("a folder already in the working directory has no switch and is read as it is", async () => {
      const snap = await buildFolderSnapshot(fakeApp(withCopy), "Arbeit/P/docs", settings({ workDir: "Arbeit", useWorkCopy: true }));
      expect(snap.folder!.workCopy).toEqual({ available: false, reason: "inside-workdir" });
      expect(snap.folder!.sourcePath).toBe("Arbeit/P/docs");
      expect(titles(snap)).toEqual(["0 Nur in der Kopie"]);
    });

    it("an unusable working directory is reported, not followed out of the vault", async () => {
      const snap = await buildFolderSnapshot(fakeApp(docs), "P/docs", settings({ workDir: "../x", useWorkCopy: true }));
      expect(snap.folder!.workCopy).toEqual({ available: false, reason: "invalid-workdir" });
      expect(snap.folder!.sourcePath).toBe("P/docs");
    });
  });

  it("an empty folder, a missing folder and a folder with only hidden or excluded pages give no rows", async () => {
    const only: Record<string, Note> = { "P/leer/0 - x.md": { body: "x" }, "P/leer/y.md": { body: "y", fm: { epub_exclude: true } } };
    const app = fakeApp(only, ["P/nichts"]);
    expect((await buildFolderSnapshot(app, "P/nichts", settings())).folder!.rows).toEqual([]);
    expect((await buildFolderSnapshot(app, "P/fehlt", settings())).folder!.rows).toEqual([]);
    const hidden = await buildFolderSnapshot(app, "P/leer", settings({ folderNumberPrefix: true }));
    expect(hidden.folder!.rows).toEqual([]);
    expect(hidden.folder!.hiddenCount).toBe(1);
  });
});
