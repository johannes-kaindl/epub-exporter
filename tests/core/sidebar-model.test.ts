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
    });
  });

  it("maps a note snapshot with no chapters", () => {
    const model = buildSidebarModel({ kind: "note", title: "Some Note", chapters: [] });
    expect(model).toEqual({ context: "note", title: "Some Note", chapters: [], missingCount: 0 });
  });

  it("maps null / none to the empty context", () => {
    expect(buildSidebarModel(null)).toEqual({ context: "none", title: "", chapters: [], missingCount: 0 });
    expect(buildSidebarModel({ kind: "none", title: "", chapters: [] })).toEqual({
      context: "none",
      title: "",
      chapters: [],
      missingCount: 0,
    });
  });
});
