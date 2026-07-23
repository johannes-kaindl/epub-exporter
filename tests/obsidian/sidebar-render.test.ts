import { describe, it, expect } from "vitest";
import { makeFakeEl } from "../mocks/obsidian";
import { renderSidebar } from "../../src/obsidian/sidebar-render";
import type { SidebarModel } from "../../src/core/sidebar-model";

const noop = {
  onExport: () => {},
  onInsertFrontmatter: () => {},
  onConsolidate: () => {},
  onReorder: () => {},
  onDragStart: () => {},
  onDragEnd: () => {},
};

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
      canReorder: true,
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
      { context: "book", title: "B", chapters: [], missingCount: 0, canReorder: false },
      { onExport: () => exported++, onInsertFrontmatter: () => meta++, onConsolidate: () => {} }
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
      { context: "note", title: "Solo", chapters: [], missingCount: 0, canReorder: false },
      { onExport: () => exported++, onInsertFrontmatter: () => {}, onConsolidate: () => {} }
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
    renderSidebar(root, { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false }, noop);
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    expect(r.find("epub-sb-empty")).not.toBeNull();
    expect(r.find("epub-sb-action-export")).toBeNull();
  });

  it("re-render clears prior content (mount-once)", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    const r = root as unknown as ReturnType<typeof makeFakeEl>;
    renderSidebar(root, { context: "book", title: "B", chapters: [{ title: "A", status: "ok" }], missingCount: 0, canReorder: false }, noop);
    renderSidebar(root, { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false }, noop);
    expect(r.findAll("epub-sb-chapter")).toHaveLength(0);
  });

  it("renders a consolidate button in the book context and wires the handler", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let consolidated = 0;
    const model = { context: "book" as const, title: "B", chapters: [], missingCount: 0, canReorder: false };
    renderSidebar(root as unknown as HTMLElement, model, {
      onExport() {},
      onInsertFrontmatter() {},
      onConsolidate() {
        consolidated++;
      },
    });
    const r = root as unknown as ReturnType<typeof makeFakeEl>;
    const btn = r.find("epub-sb-action-consolidate");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(consolidated).toBe(1);
  });
});

describe("renderSidebar · Kapitel umsortieren", () => {
  const twoChapterModel: SidebarModel = {
    context: "book",
    title: "B",
    chapters: [
      { title: "Eins", status: "ok" },
      { title: "Zwei", status: "ok" },
    ],
    missingCount: 0,
    canReorder: true,
  };

  it("gives every chapter row a drag handle and makes it draggable", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, twoChapterModel, noop);
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    expect(r.findAll("epub-sb-chapter-grip")).toHaveLength(2);
    expect(r.findAll("epub-sb-chapter").every((li) => li.draggable)).toBe(true);
  });

  it("omits handles when there is nothing to reorder", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(
      root,
      { context: "book", title: "B", chapters: [{ title: "Eins", status: "ok" }], missingCount: 0, canReorder: false },
      noop
    );
    const r = root as unknown as ReturnType<typeof makeFakeEl>;
    expect(r.find("epub-sb-chapter-grip")).toBeNull();
    expect(r.find("epub-sb-chapter")!.draggable).toBe(false);
  });

  it("reports source and target index, plus the chapter count, on drop", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    const calls: Array<[number, number, number]> = [];
    renderSidebar(root, twoChapterModel, {
      ...noop,
      onReorder: (from, to, count) => calls.push([from, to, count]),
    });
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    rows[0].dispatch("dragstart");
    rows[1].dispatch("drop");
    expect(calls).toEqual([[0, 1, 2]]);
  });

  it("does not fire when a row is dropped on itself", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let calls = 0;
    renderSidebar(root, twoChapterModel, { ...noop, onReorder: () => calls++ });
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    rows[0].dispatch("dragstart");
    rows[0].dispatch("drop");
    expect(calls).toBe(0);
  });

  it("preventDefaults dragover so the drop is allowed at all", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, twoChapterModel, noop);
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    rows[0].dispatch("dragstart");
    expect(rows[1].dispatch("dragover").defaultPrevented).toBe(true);
  });

  it("brackets the gesture with onDragStart and onDragEnd", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    const seen: string[] = [];
    renderSidebar(root, twoChapterModel, {
      ...noop,
      onDragStart: () => seen.push("start"),
      onDragEnd: () => seen.push("end"),
    });
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    rows[0].dispatch("dragstart");
    rows[1].dispatch("drop");
    rows[0].dispatch("dragend");
    expect(seen).toEqual(["start", "end"]);
  });
});
