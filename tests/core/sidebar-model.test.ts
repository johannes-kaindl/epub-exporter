import { describe, it, expect } from "vitest";
import { buildBookChapters, buildSidebarModel } from "../../src/core/sidebar-model";

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
    });
  });

  it("maps a note snapshot with no chapters", () => {
    const model = buildSidebarModel({ kind: "note", title: "Some Note", chapters: [] });
    expect(model).toEqual({ context: "note", title: "Some Note", chapters: [], missingCount: 0, canReorder: false });
  });

  it("maps null / none to the empty context", () => {
    expect(buildSidebarModel(null)).toEqual({ context: "none", title: "", chapters: [], missingCount: 0, canReorder: false });
    expect(buildSidebarModel({ kind: "none", title: "", chapters: [] })).toEqual({
      context: "none",
      title: "",
      chapters: [],
      missingCount: 0,
      canReorder: false,
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
