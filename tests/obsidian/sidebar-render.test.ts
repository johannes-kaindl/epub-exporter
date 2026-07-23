import { describe, it, expect } from "vitest";
import { makeFakeEl, Platform } from "../mocks/obsidian";
import { renderSidebar } from "../../src/obsidian/sidebar-render";
import type { SidebarModel } from "../../src/core/sidebar-model";
import { t } from "../../src/vendor/kit/i18n";

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

  it("keeps the grip decorative but exposes the drag hint on the focusable row", () => {
    // aria-hidden on the grip hides its title from assistive tech too, so the
    // hint has to live on the li — the element that is actually focusable and
    // draggable — or a screen reader user gets no drag affordance at all.
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, twoChapterModel, noop);
    const r = root as unknown as ReturnType<typeof makeFakeEl>;

    const grip = r.find("epub-sb-chapter-grip")!;
    expect(grip.getAttribute("aria-hidden")).toBe("true");
    expect(grip.getAttribute("title")).toBeNull();

    const row = r.find("epub-sb-chapter")!;
    expect(row.getAttribute("title")).toBe(t("view.dragHint"));
  });

  it("omits the grip and drag hint on mobile even though the note itself is reorderable", () => {
    Platform.isMobile = true;
    try {
      const root = makeFakeEl() as unknown as HTMLElement;
      renderSidebar(root, twoChapterModel, noop);
      const r = root as unknown as ReturnType<typeof makeFakeEl>;

      expect(r.find("epub-sb-chapter-grip")).toBeNull();
      const row = r.find("epub-sb-chapter")!;
      expect(row.draggable).toBe(false);
      expect(row.getAttribute("title")).toBeNull();
    } finally {
      Platform.isMobile = false;
    }
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

describe("renderSidebar · Tastatur", () => {
  const model: SidebarModel = {
    context: "book",
    title: "B",
    chapters: [
      { title: "Eins", status: "ok" },
      { title: "Zwei", status: "ok" },
      { title: "Drei", status: "ok" },
    ],
    missingCount: 0,
    canReorder: true,
  };

  function rowsFor(handlers: Parameters<typeof renderSidebar>[2]) {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, model, handlers);
    return (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");
  }

  it("moves a row up with Alt+ArrowUp", () => {
    const calls: Array<[number, number, number]> = [];
    const rows = rowsFor({ ...noop, onReorder: (f, t2, c) => calls.push([f, t2, c]) });
    rows[1].dispatch("keydown", { key: "ArrowUp", altKey: true });
    expect(calls).toEqual([[1, 0, 3]]);
  });

  it("moves a row down with Alt+ArrowDown", () => {
    const calls: Array<[number, number, number]> = [];
    const rows = rowsFor({ ...noop, onReorder: (f, t2, c) => calls.push([f, t2, c]) });
    rows[1].dispatch("keydown", { key: "ArrowDown", altKey: true });
    expect(calls).toEqual([[1, 2, 3]]);
  });

  it("ignores the arrows without Alt", () => {
    let calls = 0;
    const rows = rowsFor({ ...noop, onReorder: () => calls++ });
    rows[1].dispatch("keydown", { key: "ArrowUp", altKey: false });
    expect(calls).toBe(0);
  });

  it("stays put at the edges", () => {
    let calls = 0;
    const rows = rowsFor({ ...noop, onReorder: () => calls++ });
    rows[0].dispatch("keydown", { key: "ArrowUp", altKey: true });
    rows[2].dispatch("keydown", { key: "ArrowDown", altKey: true });
    expect(calls).toBe(0);
  });

  it("focuses the requested row after building, so repeated presses keep working", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, model, noop, 2);
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");
    expect(rows[2].focusCount).toBe(1);
    expect(rows[0].focusCount).toBe(0);
  });
});
