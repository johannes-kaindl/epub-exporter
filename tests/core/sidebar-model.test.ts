import { describe, it, expect } from "vitest";
import { buildBookChapters, buildFolderRows, buildSidebarModel, type FolderPreview } from "../../src/core/sidebar-model";
import type { BookTree } from "../../src/core/folder-tree";

describe("buildBookChapters", () => {
  it("marks resolved embeds ok and unresolved embeds missing (spine order)", () => {
    const body = ["# Book", "", "![[01 Vorwort]]", "![[02 Fehlt]]", "![[03 Ende]]"].join("\n");
    const resolve = (target: string) =>
      target === "02 Fehlt" ? null : { title: `T:${target}` };

    const chapters = buildBookChapters(body, resolve);

    expect(chapters).toEqual([
      { title: "T:01 Vorwort", status: "ok" },
      { title: "02 Fehlt", status: "missing" }, // falls back to the raw target
      { title: "T:03 Ende", status: "ok" },
    ]);
  });

  it("returns [] when the body has no top-level embeds", () => {
    expect(buildBookChapters("just prose, no embeds", () => ({ title: "x" }))).toEqual([]);
  });
});

describe("buildSidebarModel", () => {
  it("maps a book snapshot and counts missing chapters", () => {
    const snap = {
      kind: "book" as const,
      title: "My Book",
      chapters: [
        { title: "A", status: "ok" as const },
        { title: "B", status: "missing" as const },
      ],
    };
    expect(buildSidebarModel(snap)).toEqual({
      context: "book",
      title: "My Book",
      chapters: snap.chapters,
      missingCount: 1,
      canReorder: true,
      canGenerateCover: false,
    });
  });

  it("maps a note snapshot with no chapters", () => {
    const model = buildSidebarModel({ kind: "note", title: "Some Note", chapters: [] });
    expect(model).toEqual({ context: "note", title: "Some Note", chapters: [], missingCount: 0, canReorder: false, canGenerateCover: false });
  });

  it("maps null / none to the empty context", () => {
    expect(buildSidebarModel(null)).toEqual({ context: "none", title: "", chapters: [], missingCount: 0, canReorder: false, canGenerateCover: false });
    expect(buildSidebarModel({ kind: "none", title: "", chapters: [] })).toEqual({
      context: "none",
      title: "",
      chapters: [],
      missingCount: 0,
      canReorder: false,
      canGenerateCover: false,
    });
  });
});

describe("buildSidebarModel · canReorder", () => {
  const ch = (title: string) => ({ title, status: "ok" as const });

  it("is true for a book with more than one chapter", () => {
    const m = buildSidebarModel({ kind: "book", title: "B", chapters: [ch("A"), ch("B")] });
    expect(m.canReorder).toBe(true);
  });

  it("is false for a book with a single chapter — nothing to reorder", () => {
    const m = buildSidebarModel({ kind: "book", title: "B", chapters: [ch("A")] });
    expect(m.canReorder).toBe(false);
  });

  it("is false in the note and none contexts", () => {
    expect(buildSidebarModel({ kind: "note", title: "N", chapters: [] }).canReorder).toBe(false);
    expect(buildSidebarModel(null).canReorder).toBe(false);
  });
});

describe("buildSidebarModel — cover capability", () => {
  const bookSnap = {
    kind: "book" as const,
    title: "Salt Marsh",
    chapters: [{ title: "One", status: "ok" as const }],
  };

  it("carries the provider availability into the model", () => {
    expect(buildSidebarModel(bookSnap, { canGenerateCover: true }).canGenerateCover).toBe(true);
    expect(buildSidebarModel(bookSnap, { canGenerateCover: false }).canGenerateCover).toBe(false);
  });

  it("defaults to unavailable when nothing is passed", () => {
    // Absence of information is not permission to show the button: an older
    // caller that does not know about covers must not switch the feature on.
    expect(buildSidebarModel(bookSnap).canGenerateCover).toBe(false);
  });

  it("never reports the capability for a plain note", () => {
    const noteSnap = { kind: "note" as const, title: "Just a note", chapters: [] };
    expect(buildSidebarModel(noteSnap, { canGenerateCover: true }).canGenerateCover).toBe(false);
  });
});

describe("buildFolderRows", () => {
  const page = (path: string, title: string) => ({ kind: "page" as const, path, title });
  const tree: BookTree = {
    title: "docs",
    intro: page("docs/README.md", "Überblick"),
    hiddenCount: 2,
    children: [
      page("docs/STAND.md", "Stand"),
      {
        kind: "chapter",
        title: "Tutorials",
        folderPath: "docs/tutorials",
        intro: page("docs/tutorials/README.md", "Tutorials"),
        children: [
          page("docs/tutorials/a.md", "Lektion 1"),
          { kind: "chapter", title: "Tief", folderPath: "docs/tutorials/tief", intro: null, children: [page("docs/tutorials/tief/x.md", "X")] },
        ],
      },
    ],
  };

  it("lists the book the way the table of contents will: root intro first, chapters with their children indented", () => {
    expect(buildFolderRows(tree)).toEqual([
      { title: "Überblick", depth: 0, kind: "page" },
      { title: "Stand", depth: 0, kind: "page" },
      { title: "Tutorials", depth: 0, kind: "chapter" },
      { title: "Lektion 1", depth: 1, kind: "page" },
      { title: "Tief", depth: 1, kind: "chapter" },
      { title: "X", depth: 2, kind: "page" },
    ]);
  });

  it("does not list a chapter's intro page again as a child (the chapter's entry is that page)", () => {
    const titles = buildFolderRows(tree).map((r) => r.title);
    expect(titles.filter((t) => t === "Tutorials")).toHaveLength(1);
  });

  it("gives a tree without pages no rows", () => {
    expect(buildFolderRows({ title: "leer", intro: null, children: [], hiddenCount: 3 })).toEqual([]);
  });
});

describe("buildSidebarModel · folder", () => {
  const folder: FolderPreview = {
    rows: [{ title: "Eins", depth: 0, kind: "page" }],
    hiddenCount: 1,
    sourcePath: "P/docs",
    workCopy: { available: true, enabled: false, path: "Arbeit/P/docs", exists: false },
  };

  it("maps a folder snapshot to the folder context and passes the preview through", () => {
    const model = buildSidebarModel({ kind: "folder", title: "docs", chapters: [], folder });
    expect(model.context).toBe("folder");
    expect(model.title).toBe("docs");
    expect(model.folder).toEqual(folder);
    expect(model.chapters).toEqual([]);
    expect(model.canReorder).toBe(false);
    expect(model.canGenerateCover).toBe(false);
  });

  it("a folder snapshot without a preview still yields an empty preview, never undefined", () => {
    const model = buildSidebarModel({ kind: "folder", title: "docs", chapters: [] });
    expect(model.folder?.rows).toEqual([]);
    expect(model.folder?.workCopy).toEqual({ available: false, reason: "no-workdir" });
  });

  it("other contexts carry no folder preview", () => {
    expect(buildSidebarModel({ kind: "note", title: "N", chapters: [] }).folder).toBeUndefined();
    expect(buildSidebarModel(null).folder).toBeUndefined();
  });

  it("a cover capability does not leak into the folder context", () => {
    expect(buildSidebarModel({ kind: "folder", title: "d", chapters: [], folder }, { canGenerateCover: true }).canGenerateCover).toBe(false);
  });
});
