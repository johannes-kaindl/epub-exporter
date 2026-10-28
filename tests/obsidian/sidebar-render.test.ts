import { describe, it, expect } from "vitest";
import { makeFakeEl, Platform } from "../mocks/obsidian";
import { renderSidebar } from "../../src/obsidian/sidebar-render";
import type { SidebarModel } from "../../src/core/sidebar-model";
import { t, setLang } from "../../src/vendor/kit/i18n";
import { registerI18n } from "../../src/i18n/strings";

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
      { ...noop, onExport: () => { exported++; }, onInsertFrontmatter: () => { meta++; } }
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
      { ...noop, onExport: () => { exported++; } }
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

  // UI-STANDARD § 8 Empty-State: kurzer Text, hoechstens ein CTA. Der Hinweis auf den Befehl ist ein
  // zweites Element unter dem unveraenderten Satz, kein Knopf; der Befehlsname kommt aus `cmd.insertFrontmatter`,
  // damit er nicht von der Befehlsliste wegdriftet.
  it.each(["en", "de"] as const)("none context (%s): a second line names the command that starts a book note, with no button", (lang) => {
    registerI18n();
    setLang(lang);
    try {
      const root = makeFakeEl() as unknown as HTMLElement;
      renderSidebar(root, { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false }, noop);
      const r = root as unknown as ReturnType<typeof makeFakeEl>;

      const empties = r.findAll("epub-sb-empty");
      expect(empties).toHaveLength(2);
      expect(empties[0]!.text).toBe(t("view.empty"));
      const hint = r.find("epub-sb-empty-hint")!;
      expect(hint).toBe(empties[1]);
      // The command name is the palette's own string, not a copy of it.
      expect(t("cmd.insertFrontmatter")).not.toBe("cmd.insertFrontmatter");
      expect(hint.text).toContain(t("cmd.insertFrontmatter"));
      expect(hint.text).not.toContain("{0}");
      expect(hint.text).not.toBe("view.emptyHint");
      expect(r.findAll("epub-sb-btn")).toHaveLength(0);
    } finally {
      setLang("en");
    }
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
      ...noop,
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
      onReorder: (from, to, count) => { calls.push([from, to, count]); },
    });
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    rows[0].dispatch("dragstart");
    rows[1].dispatch("drop");
    expect(calls).toEqual([[0, 1, 2]]);
  });

  it("does not fire when a row is dropped on itself", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let calls = 0;
    renderSidebar(root, twoChapterModel, { ...noop, onReorder: () => { calls++; } });
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

  it("uses the plugin-private MIME type, never text/plain (Fix 2 regression guard)", () => {
    // text/plain would let a drag that overshoots onto the adjacent editor get
    // pasted straight into the book note by CodeMirror — the very note this
    // feature promises to keep byte-identical. Guard the format actually
    // handed to dataTransfer.setData, not just that a drag starts.
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, twoChapterModel, noop);
    const rows = (root as unknown as ReturnType<typeof makeFakeEl>).findAll("epub-sb-chapter");

    const formats: string[] = [];
    const dataTransfer = {
      effectAllowed: "",
      setData: (format: string, _data: string) => {
        formats.push(format);
      },
    };
    rows[0].dispatch("dragstart", { dataTransfer });

    expect(formats).toEqual(["application/x-epub-exporter-chapter"]);
    expect(formats).not.toContain("text/plain");
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
    const rows = rowsFor({ ...noop, onReorder: (f, t2, c) => { calls.push([f, t2, c]); } });
    rows[1].dispatch("keydown", { key: "ArrowUp", altKey: true });
    expect(calls).toEqual([[1, 0, 3]]);
  });

  it("moves a row down with Alt+ArrowDown", () => {
    const calls: Array<[number, number, number]> = [];
    const rows = rowsFor({ ...noop, onReorder: (f, t2, c) => { calls.push([f, t2, c]); } });
    rows[1].dispatch("keydown", { key: "ArrowDown", altKey: true });
    expect(calls).toEqual([[1, 2, 3]]);
  });

  it("ignores the arrows without Alt", () => {
    let calls = 0;
    const rows = rowsFor({ ...noop, onReorder: () => { calls++; } });
    rows[1].dispatch("keydown", { key: "ArrowUp", altKey: false });
    expect(calls).toBe(0);
  });

  it("stays put at the edges", () => {
    let calls = 0;
    const rows = rowsFor({ ...noop, onReorder: () => { calls++; } });
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

describe("renderSidebar — generated cover", () => {
  const bookModel = (over: Partial<SidebarModel> = {}): SidebarModel => ({
    context: "book",
    title: "Salt Marsh",
    chapters: [{ title: "One", status: "ok" }],
    missingCount: 0,
    canReorder: false,
    ...over,
  });

  it("offers cover generation only when a provider is available", () => {
    // The button is not a permanent fixture: local-image-generator is optional
    // and can be disabled while Obsidian runs. Showing a control that cannot
    // work is the failure this asserts against.
    const withProvider = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(withProvider, bookModel({ canGenerateCover: true }), noop);
    expect((withProvider as unknown as ReturnType<typeof makeFakeEl>).allText)
      .toContain(t("view.generateCover"));

    const without = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(without, bookModel({ canGenerateCover: false }), noop);
    expect((without as unknown as ReturnType<typeof makeFakeEl>).allText)
      .not.toContain(t("view.generateCover"));
  });

  it("never offers cover generation outside a book note", () => {
    // A plain note has no title, author or spine to draw a cover for — and no
    // frontmatter to write the result into.
    const root = makeFakeEl() as unknown as HTMLElement;
    renderSidebar(root, bookModel({ context: "note", canGenerateCover: true }), noop);
    expect((root as unknown as ReturnType<typeof makeFakeEl>).allText)
      .not.toContain(t("view.generateCover"));
  });

  it("cover button fires onGenerateCover", () => {
    const root = makeFakeEl() as unknown as HTMLElement;
    let fired = 0;
    renderSidebar(root, bookModel({ canGenerateCover: true }), {
      ...noop,
      onGenerateCover: () => fired++,
    });
    const r = root as unknown as ReturnType<typeof makeFakeEl>;
    const btn = r.findAll("epub-sb-btn").find((b: { text?: string }) => b.text === t("view.generateCover"));
    btn?.click?.();
    expect(fired).toBe(1);
  });
});

describe("renderSidebar · Ordnermodus", () => {
  type Folder = NonNullable<SidebarModel["folder"]>;
  const folderModel = (over: Partial<Folder> = {}, title = "docs"): SidebarModel => ({
    context: "folder",
    title,
    chapters: [],
    missingCount: 0,
    canReorder: false,
    canGenerateCover: false,
    folder: {
      rows: [
        { title: "Überblick", depth: 0, kind: "page" },
        { title: "Tutorials", depth: 0, kind: "chapter" },
        { title: "Lektion 1", depth: 1, kind: "page" },
      ],
      hiddenCount: 0,
      sourcePath: "Projekte/docs",
      workCopy: { available: true, enabled: false, path: "Arbeit/Projekte/docs", exists: false },
      ...over,
    },
  });
  const draw = (model: SidebarModel, handlers = {}) => {
    const root = makeFakeEl();
    renderSidebar(root as unknown as HTMLElement, model, { ...noop, ...handlers });
    return root;
  };

  it("shows a header for the folder, its name, and the hint on the number rule", () => {
    registerI18n();
    setLang("en");
    const r = draw(folderModel());
    expect(r.find("epub-sb-title")!.allText).toBe(t("view.context.folder"));
    expect(r.find("epub-sb-subtitle")!.allText).toBe("docs");
    expect(r.find("epub-sb-hint")!.allText).toBe(t("view.folder.hint"));
    expect(t("view.folder.hint")).toContain("01 - Intro");
    expect(t("view.folder.hint")).toContain("0 hides");
  });

  it("shows one row per entry with its depth, a folder or file icon, and its title", () => {
    const r = draw(folderModel());
    const rows = r.findAll("epub-sb-row");
    expect(rows.map((row) => row.getAttribute("data-depth"))).toEqual(["0", "0", "1"]);
    expect(rows.map((row) => row.find("epub-sb-row-title")!.allText)).toEqual(["Überblick", "Tutorials", "Lektion 1"]);
    expect(rows.map((row) => row.find("epub-sb-row-icon")!.getAttribute("data-icon"))).toEqual(["file-text", "folder", "file-text"]);
    expect(r.find("epub-sb-empty")).toBeNull();
  });

  it("caps the indentation at depth 6, the text keeps its real order", () => {
    const rows = [0, 1, 6, 7, 12].map((depth) => ({ title: `T${depth}`, depth, kind: "page" as const }));
    const r = draw(folderModel({ rows }));
    expect(r.findAll("epub-sb-row").map((row) => row.getAttribute("data-depth"))).toEqual(["0", "1", "6", "6", "6"]);
  });

  it("names what it works on: the original, or the working copy once that is on and exists", () => {
    registerI18n();
    setLang("en");
    expect(draw(folderModel()).find("epub-sb-source")!.allText).toBe("Original: Projekte/docs");
    const onCopy = folderModel({
      sourcePath: "Arbeit/Projekte/docs",
      workCopy: { available: true, enabled: true, path: "Arbeit/Projekte/docs", exists: true },
    });
    expect(draw(onCopy).find("epub-sb-source")!.allText).toBe("Working copy: Arbeit/Projekte/docs");
  });

  it("shows the hidden line only when something is hidden, with a text and an icon", () => {
    registerI18n();
    setLang("en");
    expect(draw(folderModel()).find("epub-sb-hidden")).toBeNull();
    const hidden = draw(folderModel({ hiddenCount: 3 })).find("epub-sb-hidden")!;
    expect(hidden.allText).toBe("3 hidden");
    expect(hidden.find("epub-sb-hidden-icon")!.getAttribute("data-icon")).toBe("eye-off");
  });

  it("shows the empty state, not an empty list, when there are no rows", () => {
    const r = draw(folderModel({ rows: [] }));
    expect(r.find("epub-sb-empty")).not.toBeNull();
    expect(r.find("epub-sb-empty")!.allText).toBe(t("view.folder.empty"));
    expect(r.find("epub-sb-tree")).toBeNull();
    expect(r.findAll("epub-sb-row")).toHaveLength(0);
  });

  describe("working copy switch (state button)", () => {
    it.each(["en", "de"] as const)("states the actual state in its label, in %s, and in aria-pressed", (lang) => {
      registerI18n();
      setLang(lang);
      const off = draw(folderModel()).find("epub-sb-action-copy-toggle")!;
      expect(off.getAttribute("aria-pressed")).toBe("false");
      expect(off.allText).toContain(t("view.folder.copyOff"));
      expect(off.allText).not.toContain(t("view.folder.copyOn"));
      expect(off.getAttribute("title")).toBe(`${t("view.folder.copyOff")} — ${t("view.folder.copyClickOn")}`);

      const on = draw(
        folderModel({ workCopy: { available: true, enabled: true, path: "Arbeit/Projekte/docs", exists: true } })
      ).find("epub-sb-action-copy-toggle")!;
      expect(on.getAttribute("aria-pressed")).toBe("true");
      expect(on.allText).toContain(t("view.folder.copyOn"));
      expect(on.getAttribute("title")).toBe(`${t("view.folder.copyOn")} — ${t("view.folder.copyClickOff")}`);
    });

    it("fires onFolderToggleWorkCopy exactly once per click", () => {
      let toggled = 0;
      const r = draw(folderModel(), { onFolderToggleWorkCopy: () => { toggled++; } });
      r.find("epub-sb-action-copy-toggle")!.click();
      expect(toggled).toBe(1);
    });

    it.each([
      ["no-workdir", "view.folder.copyNo.noWorkdir"],
      ["invalid-workdir", "view.folder.copyNo.invalidWorkdir"],
      ["inside-workdir", "view.folder.copyNo.insideWorkdir"],
      ["contains-workdir", "view.folder.copyNo.containsWorkdir"],
    ] as const)("replaces the switch with an explanation when it is not available (%s)", (reason, key) => {
      registerI18n();
      setLang("en");
      const r = draw(folderModel({ workCopy: { available: false, reason } }));
      expect(r.find("epub-sb-action-copy-toggle")).toBeNull();
      expect(r.find("epub-sb-action-copy-create")).toBeNull();
      expect(r.find("epub-sb-copy-note")!.allText).toBe(t(key));
    });

    it("offers to create the copy only while the switch is on and the copy is missing", () => {
      const copy = (enabled: boolean, exists: boolean): Partial<Folder> => ({
        workCopy: { available: true, enabled, path: "Arbeit/Projekte/docs", exists },
      });
      expect(draw(folderModel(copy(false, false))).find("epub-sb-action-copy-create")).toBeNull();
      expect(draw(folderModel(copy(false, true))).find("epub-sb-action-copy-create")).toBeNull();
      expect(draw(folderModel(copy(true, true))).find("epub-sb-action-copy-create")).toBeNull();
      const r = draw(folderModel(copy(true, false)));
      expect(r.find("epub-sb-action-copy-create")).not.toBeNull();
      expect(r.find("epub-sb-copy-note")!.allText).toContain("Arbeit/Projekte/docs");
    });

    it("fires onFolderCreateWorkCopy exactly once per click", () => {
      let created = 0;
      const r = draw(
        folderModel({ workCopy: { available: true, enabled: true, path: "Arbeit/Projekte/docs", exists: false } }),
        { onFolderCreateWorkCopy: () => { created++; } }
      );
      r.find("epub-sb-action-copy-create")!.click();
      expect(created).toBe(1);
    });
  });

  it("wires export, import and close to their handlers, once each, and nothing else", () => {
    const calls: string[] = [];
    const r = draw(folderModel(), {
      onFolderExport: () => calls.push("export"),
      onFolderImport: () => calls.push("import"),
      onFolderClose: () => calls.push("close"),
      onExport: () => calls.push("note-export"),
    });
    r.find("epub-sb-action-export")!.click();
    r.find("epub-sb-action-import")!.click();
    r.find("epub-sb-action-close")!.click();
    expect(calls).toEqual(["export", "import", "close"]);
    expect(r.find("epub-sb-action-consolidate")).toBeNull();
    expect(r.find("epub-sb-action-meta")).toBeNull();
    expect(r.find("epub-sb-action-cover")).toBeNull();
  });

  it("gives the close button an accessible name and a button element", () => {
    registerI18n();
    setLang("de");
    const close = draw(folderModel()).find("epub-sb-action-close")!;
    expect(close.tag).toBe("button");
    expect(close.getAttribute("aria-label")).toBe(t("view.folder.close"));
  });

  it("offers no drag handles: a folder preview cannot be reordered", () => {
    const r = draw(folderModel());
    expect(r.findAll("epub-sb-chapter-grip")).toHaveLength(0);
    expect(r.findAll("epub-sb-row").every((row) => !row.draggable)).toBe(true);
  });
});
