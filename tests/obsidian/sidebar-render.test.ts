import { describe, it, expect } from "vitest";
import { makeFakeEl } from "../mocks/obsidian";
import { renderSidebar } from "../../src/obsidian/sidebar-render";
import type { SidebarModel } from "../../src/core/sidebar-model";

const noop = { onExport: () => {}, onInsertFrontmatter: () => {} };

describe("renderSidebar", () => {
  it("book context: renders one row per chapter, flags missing, shows a warning", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    const model: SidebarModel = {
      context: "book",
      title: "My Book",
      chapters: [
        { title: "Vorwort", status: "ok" },
        { title: "Hauptteil", status: "missing" },
      ],
      missingCount: 1,
    };

    renderSidebar(root, model, noop);
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    expect(r.findAll("epub-sb-chapter")).toHaveLength(2);
    expect(r.findAll("is-missing")).toHaveLength(1);
    expect(r.find("epub-sb-warning")).not.toBeNull();
    expect(r.allText).toContain("My Book");
  });

  it("book context: export button fires onExport, meta button fires onInsertFrontmatter", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let exported = 0;
    let meta = 0;
    renderSidebar(
      root,
      { context: "book", title: "B", chapters: [], missingCount: 0 },
      { onExport: () => exported++, onInsertFrontmatter: () => meta++ }
    );
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    r.find("epub-sb-action-export")!.click();
    r.find("epub-sb-action-meta")!.click();
    expect(exported).toBe(1);
    expect(meta).toBe(1);
    expect(r.find("epub-sb-warning")).toBeNull(); // missingCount 0 → no warning
  });

  it("note context: shows export + make-book actions, no chapter list", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let exported = 0;
    renderSidebar(
      root,
      { context: "note", title: "Solo", chapters: [], missingCount: 0 },
      { onExport: () => exported++, onInsertFrontmatter: () => {} }
    );
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    expect(r.findAll("epub-sb-chapter")).toHaveLength(0);
    expect(r.find("epub-sb-action-export")).not.toBeNull();
    expect(r.find("epub-sb-action-meta")).not.toBeNull();
    r.find("epub-sb-action-export")!.click();
    expect(exported).toBe(1);
  });

  it("none context: shows an empty-state hint and no action buttons", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, { context: "none", title: "", chapters: [], missingCount: 0 }, noop);
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    expect(r.find("epub-sb-empty")).not.toBeNull();
    expect(r.find("epub-sb-action-export")).toBeNull();
  });

  it("re-render clears prior content (mount-once)", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    const r = root as unknown as ReturnType<typeof makeFakeEl>;
    renderSidebar(root, { context: "book", title: "B", chapters: [{ title: "A", status: "ok" }], missingCount: 0 }, noop);
    renderSidebar(root, { context: "none", title: "", chapters: [], missingCount: 0 }, noop);
    expect(r.findAll("epub-sb-chapter")).toHaveLength(0);
  });
});
