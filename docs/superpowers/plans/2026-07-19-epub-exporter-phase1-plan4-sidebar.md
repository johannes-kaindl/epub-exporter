# EPUB Exporter — Phase 1 Plan 4: Sidebar (Hub-View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context-sensitive right-sidebar `ItemView` that detects whether the user is on a book note or a plain note, lists a book's chapters with broken-embed warnings, and offers Export / Insert-frontmatter buttons — all reusing the existing export pipeline.

**Architecture:** A three-layer split mirroring the sibling "vendored Hub-View" pattern (REGISTRY Z. 82) but **without its multi-tab machinery** — the EPUB sidebar is a *single* context-sensitive panel in every phase, so the `FinancePanel`/tab abstraction would be YAGNI. Layer 1 is a **pure view-model** (`src/core/sidebar-model.ts`: `SidebarSnapshot` → `SidebarModel`, node-testable, reuses `parseEmbedSpine`). Layer 2 is a **pure DOM renderer** (`src/obsidian/sidebar-render.ts`: `renderSidebar(root, model, handlers)`, node-testable via a vendored Obsidian test mock). Layer 3 is the **thin Obsidian shell** (`src/obsidian/hub-view.ts`: `EpubHubView extends ItemView`, plus the `resolveTargetFile` gotcha helper and `buildSnapshot` glue) wired in `main.ts`. This keeps derivation and rendering fully tested and leaves only the `ItemView` lifecycle + `app.*` reads for the GUI-smoke.

**Tech Stack:** TypeScript · esbuild · vitest (node env) · vendored `obsidian-kit` i18n/settings · dep-free runtime. UI DOM built with Obsidian's `createEl`/`createDiv`/`setIcon` helpers; tests use a small vendored `obsidian` module alias (modeled on `obsidian-kit/src/testing/obsidian-mock.ts`, per the `obsidian-plugin-test-pattern` skill).

## Global Constraints

- License **AGPL-3.0-or-later**; `manifest.json` `isDesktopOnly: false`, `minAppVersion: "1.8.7"` — sidebar must be mobile-safe (no desktop-only APIs).
- **No npm runtime dependency** — dep-free, offline, mobile. Test-only code (the `obsidian` mock) must never be imported by `src/`.
- **i18n EN/DE parity** — every new UI string added to `EN` **and** `DE` in `src/i18n/strings.ts`; the existing `tests/i18n/strings.test.ts` parity test guards this.
- **Gotcha Z. 91:** buttons/detection acting on "the current note" must **not** use `getActiveViewOfType(MarkdownView)` (clicking the panel makes it the active view → `null`). Resolve via `app.workspace.getMostRecentLeaf(app.workspace.rootSplit)`.
- **Gotcha Z. 37:** never auto-open the view unconditionally — gate behind the existing `openSidebarOnStartup` setting (default `false`) and `app.workspace.onLayoutReady`.
- **Mount-once:** the panel DOM is (re)built by `renderSidebar` on each context change; no partial DOM diffing.
- `main.js` is **gitignored** in this repo — never commit it. Plugin install copies `main.js` + `manifest.json` + (new) `styles.css` into the vault plugin folder.

---

## File Structure

**Create:**
- `src/core/sidebar-model.ts` — pure view-model: `SidebarSnapshot`, `SidebarChapter`, `SidebarModel`, `buildBookChapters`, `buildSidebarModel`. No `obsidian`/DOM import.
- `src/obsidian/sidebar-render.ts` — pure DOM renderer: `SidebarHandlers`, `renderSidebar(root, model, handlers)`. Imports only `setIcon` from `obsidian` + `t`.
- `src/obsidian/hub-view.ts` — `VIEW_TYPE_EPUB_HUB`, `resolveTargetFile(app)`, `SidebarBridge`, `EpubHubView extends ItemView`.
- `src/obsidian/sidebar-bridge.ts` — `buildSnapshot(app, defaultLanguage)`: reads the target note + resolves embeds into a `SidebarSnapshot`.
- `tests/mocks/obsidian.ts` — vendored node stand-in for the `obsidian` module (test-only; aliased in vitest).
- `styles.css` — sidebar styling (repo root; Obsidian auto-loads it).
- Tests: `tests/core/sidebar-model.test.ts`, `tests/obsidian/sidebar-render.test.ts`, `tests/obsidian/hub-view.test.ts`, `tests/obsidian/obsidian-mock.test.ts`.

**Modify:**
- `vitest.config.ts` — add `resolve.alias` mapping `obsidian` → the vendored mock.
- `src/i18n/strings.ts` — add sidebar UI strings (EN + DE).
- `src/core/frontmatter.ts` — export a shared `stripFrontmatter(content)` helper.
- `src/obsidian/deps.ts` — import `stripFrontmatter` from core instead of its private copy (DRY).
- `src/main.ts` — `registerView`, open-sidebar command, opt-in startup, bridge wiring; refactor `insertFrontmatter()` → `insertFrontmatterFor(file)`.

---

## Task 1: Test infrastructure — vendored Obsidian mock + vitest alias

Establishes the node-side `obsidian` stand-in that Tasks 2–4 need to test DOM/`ItemView` code. Nothing in `src/` imports it; it only activates under the vitest alias, so the existing suite must stay green.

**Files:**
- Create: `tests/mocks/obsidian.ts`
- Create: `tests/obsidian/obsidian-mock.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by later tasks' tests, never by `src/`):
  - `makeFakeEl(tag?: string): FakeEl` — a fake element with `empty()`, `addClass(...c)`, `removeClass(...c)`, `toggleClass(c, on?)`, `hasClass(c)`, `createEl(tag, o?)`, `createDiv(o?)`, `createSpan(o?)`, `setAttribute/getAttribute`, `addEventListener(ev, fn)`, `set onclick`, `click()`, plus test-only `findAll(cls): FakeEl[]`, `find(cls): FakeEl | null`, `allText: string`. Options object shape: `{ cls?: string; text?: string; attr?: Record<string,string> }`.
  - `setIcon(el, icon): void` — records `data-icon`.
  - Value classes: `Notice`, `TFile` (`path`/`basename`/`extension`/`parent`), `TFolder`, `MarkdownView` (`file: TFile | null`), `WorkspaceLeaf` (`view`, `setViewState`, `detach`), `ItemView` (seeds `containerEl.children = [makeFakeEl(), contentEl]`).

- [ ] **Step 1: Write the vendored mock**

Create `tests/mocks/obsidian.ts`:

```ts
// tests/mocks/obsidian.ts
// Test-only node stand-in for the "obsidian" module, activated via the vitest
// resolve.alias. Modeled on obsidian-kit/src/testing/obsidian-mock.ts
// (obsidian-plugin-test-pattern skill), trimmed to exactly what the sidebar
// code imports. NEVER import this from src/.

export class FakeEl {
  tag: string;
  children: FakeEl[] = [];
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  text = "";
  private listeners: Record<string, Array<() => void>> = {};

  constructor(tag = "div") {
    this.tag = tag;
  }

  empty(): void {
    this.children = [];
  }
  addClass(...cls: string[]): this {
    for (const c of cls) this.classes.add(c);
    return this;
  }
  removeClass(...cls: string[]): this {
    for (const c of cls) this.classes.delete(c);
    return this;
  }
  toggleClass(cls: string, on?: boolean): this {
    const want = on ?? !this.classes.has(cls);
    if (want) this.classes.add(cls);
    else this.classes.delete(cls);
    return this;
  }
  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  private make(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    const el = new FakeEl(tag);
    if (o?.cls) for (const c of o.cls.split(/\s+/).filter(Boolean)) el.classes.add(c);
    if (o?.text) el.text = o.text;
    if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.attrs[k] = v;
    this.children.push(el);
    return el;
  }
  createEl(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make(tag, o);
  }
  createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make("div", o);
  }
  createSpan(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.make("span", o);
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }

  addEventListener(ev: string, fn: () => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  set onclick(fn: () => void) {
    this.listeners["click"] = [fn];
  }
  click(): void {
    for (const fn of this.listeners["click"] ?? []) fn();
  }

  // ── test-only introspection (not part of Obsidian's API) ────────────────
  findAll(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      if (el.classes.has(cls)) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }
  find(cls: string): FakeEl | null {
    return this.findAll(cls)[0] ?? null;
  }
  get allText(): string {
    return (this.text ? [this.text] : []).concat(this.children.map((c) => c.allText)).join(" ").trim();
  }
}

export function makeFakeEl(tag = "div"): FakeEl {
  return new FakeEl(tag);
}

export function setIcon(el: FakeEl, icon: string): void {
  el.attrs["data-icon"] = icon;
}

export class Notice {
  constructor(public message?: string) {}
}

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  parent: { path: string } | null = null;
}

export class TFolder {
  path = "";
  children: unknown[] = [];
}

export class MarkdownView {
  file: TFile | null = null;
}

export class WorkspaceLeaf {
  view: unknown = null;
  async setViewState(): Promise<void> {}
  detach(): void {}
}

export class ItemView {
  containerEl = makeFakeEl();
  contentEl = makeFakeEl();
  app: unknown;
  constructor(public leaf: WorkspaceLeaf) {
    // Obsidian seeds containerEl.children[1] as the content area; mirror that.
    this.containerEl.children = [makeFakeEl(), this.contentEl];
  }
  registerEvent(): void {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
}
```

- [ ] **Step 2: Add the vitest alias**

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Test-only: src/ code that imports "obsidian" resolves to the fake.
      obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Write the mock self-test**

Create `tests/obsidian/obsidian-mock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeFakeEl, setIcon, MarkdownView, TFile } from "../mocks/obsidian";

describe("obsidian mock", () => {
  it("builds nested elements with cls/text/attr and finds them", () => {
    const root = makeFakeEl();
    const box = root.createDiv({ cls: "outer" });
    box.createSpan({ cls: "inner", text: "hi", attr: { "data-x": "1" } });
    expect(root.find("inner")?.text).toBe("hi");
    expect(root.find("inner")?.getAttribute("data-x")).toBe("1");
    expect(root.findAll("outer")).toHaveLength(1);
  });

  it("toggleClass respects the explicit on flag", () => {
    const el = makeFakeEl();
    el.toggleClass("is-hidden", true);
    expect(el.hasClass("is-hidden")).toBe(true);
    el.toggleClass("is-hidden", false);
    expect(el.hasClass("is-hidden")).toBe(false);
  });

  it("fires click listeners and records icons", () => {
    const el = makeFakeEl();
    let clicked = 0;
    el.addEventListener("click", () => clicked++);
    el.click();
    expect(clicked).toBe(1);
    setIcon(el, "book");
    expect(el.getAttribute("data-icon")).toBe("book");
  });

  it("MarkdownView instanceof works and carries a file", () => {
    const v = new MarkdownView();
    v.file = new TFile();
    expect(v instanceof MarkdownView).toBe(true);
    expect(v.file).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the new test + full suite**

Run: `npx vitest run tests/obsidian/obsidian-mock.test.ts`
Expected: PASS (4 tests).

Run: `npm test`
Expected: PASS — previous **79** tests + 4 new = **83** passing. If any pre-existing test now fails, the alias is leaking into a module that expected the real `obsidian`; investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add tests/mocks/obsidian.ts tests/obsidian/obsidian-mock.test.ts vitest.config.ts
git commit -m "test(infra): vendored obsidian mock + vitest alias for sidebar tests"
```

---

## Task 2: Pure view-model — `SidebarSnapshot` → `SidebarModel`

The node-pure derivation layer: turn an already-gathered snapshot of the target note into a render-ready model, and turn a book-note body + an embed resolver into a chapter list with ok/missing status. Reuses `parseEmbedSpine`. No `obsidian`/DOM.

**Files:**
- Create: `src/core/sidebar-model.ts`
- Test: `tests/core/sidebar-model.test.ts`

**Interfaces:**
- Consumes: `parseEmbedSpine(body: string): SpineEntry[]` from `src/core/spine-parser.ts` (`SpineEntry` = `{ target: string }`).
- Produces:
  - `type SidebarContext = "book" | "note" | "none"`
  - `type ChapterStatus = "ok" | "missing"`
  - `interface SidebarChapter { title: string; status: ChapterStatus }`
  - `interface SidebarSnapshot { kind: "book" | "note" | "none"; title: string; chapters: SidebarChapter[] }`
  - `interface SidebarModel { context: SidebarContext; title: string; chapters: SidebarChapter[]; missingCount: number }`
  - `buildBookChapters(body: string, resolve: (target: string) => { title: string } | null): SidebarChapter[]`
  - `buildSidebarModel(snap: SidebarSnapshot | null): SidebarModel`

- [ ] **Step 1: Write the failing test**

Create `tests/core/sidebar-model.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sidebar-model.test.ts`
Expected: FAIL — "Failed to resolve import ... src/core/sidebar-model".

- [ ] **Step 3: Write the implementation**

Create `src/core/sidebar-model.ts`:

```ts
import { parseEmbedSpine } from "./spine-parser";

export type SidebarContext = "book" | "note" | "none";
export type ChapterStatus = "ok" | "missing";

export interface SidebarChapter {
  title: string;
  status: ChapterStatus;
}

// Everything the sidebar model needs, already gathered from Obsidian (Plan-4 shell).
// A folder is never a sidebar context (folders have no active file), so `kind`
// is only book/note/none.
export interface SidebarSnapshot {
  kind: "book" | "note" | "none";
  title: string;
  chapters: SidebarChapter[]; // empty unless kind === "book"
}

export interface SidebarModel {
  context: SidebarContext;
  title: string;
  chapters: SidebarChapter[];
  missingCount: number;
}

// Mirror assembleBook's spine walk WITHOUT rendering: cheap enough to run on
// every active-leaf change. `epub_exclude` is intentionally NOT applied here —
// the sidebar shows the raw embed spine; exclusion is honored at export time.
export function buildBookChapters(
  body: string,
  resolve: (target: string) => { title: string } | null
): SidebarChapter[] {
  return parseEmbedSpine(body).map((entry) => {
    const hit = resolve(entry.target);
    return hit
      ? { title: hit.title, status: "ok" as const }
      : { title: entry.target, status: "missing" as const };
  });
}

export function buildSidebarModel(snap: SidebarSnapshot | null): SidebarModel {
  if (!snap || snap.kind === "none") {
    return { context: "none", title: "", chapters: [], missingCount: 0 };
  }
  if (snap.kind === "note") {
    return { context: "note", title: snap.title, chapters: [], missingCount: 0 };
  }
  const missingCount = snap.chapters.filter((c) => c.status === "missing").length;
  return { context: "book", title: snap.title, chapters: snap.chapters, missingCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sidebar-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/sidebar-model.ts tests/core/sidebar-model.test.ts
git commit -m "feat(core): pure sidebar view-model (snapshot -> model, chapter status)"
```

---

## Task 3: i18n strings + pure DOM renderer `renderSidebar`

Add the sidebar UI strings (EN/DE), then the pure renderer that builds the panel DOM from a `SidebarModel` and wires buttons to injected handlers. Node-tested via the Task-1 mock.

**Files:**
- Modify: `src/i18n/strings.ts`
- Create: `src/obsidian/sidebar-render.ts`
- Test: `tests/obsidian/sidebar-render.test.ts`

**Interfaces:**
- Consumes: `SidebarModel` from `src/core/sidebar-model.ts`; `setIcon` from `obsidian`; `t` from `src/vendor/kit/i18n`.
- Produces:
  - `interface SidebarHandlers { onExport(): void; onInsertFrontmatter(): void }`
  - `renderSidebar(root: HTMLElement, model: SidebarModel, handlers: SidebarHandlers): void`
  - DOM class contract (used by `styles.css` in Task 5): root `epub-exporter-sidebar`; `epub-sb-header`, `epub-sb-icon`, `epub-sb-title`, `epub-sb-subtitle`, `epub-sb-empty`, `epub-sb-chapters-label`, `epub-sb-chapters`, `epub-sb-chapter` (+ `is-missing`), `epub-sb-chapter-status`, `epub-sb-chapter-title`, `epub-sb-warning`, `epub-sb-btn` (+ `mod-cta`), action markers `epub-sb-action-export` / `epub-sb-action-meta`.

- [ ] **Step 1: Add the i18n strings**

In `src/i18n/strings.ts`, add these keys to the `EN` object (before the closing `};`):

```ts
  "cmd.openSidebar": "Open EPUB Exporter sidebar",
  "view.title": "EPUB Exporter",
  "view.context.book": "Book note",
  "view.context.note": "Note",
  "view.none.title": "No note selected",
  "view.empty": "Open a note to export it as EPUB.",
  "view.chaptersLabel": "Chapters",
  "view.missing": "{0} chapter(s) missing",
  "view.export": "Export as EPUB",
  "view.exportNote": "Export note as EPUB",
  "view.editMetadata": "Edit metadata",
  "view.makeBook": "Make into a book",
```

And the matching keys to the `DE` object (before its closing `};`):

```ts
  "cmd.openSidebar": "EPUB-Exporter-Seitenleiste öffnen",
  "view.title": "EPUB Exporter",
  "view.context.book": "Buch-Notiz",
  "view.context.note": "Notiz",
  "view.none.title": "Keine Notiz ausgewählt",
  "view.empty": "Öffne eine Notiz, um sie als EPUB zu exportieren.",
  "view.chaptersLabel": "Kapitel",
  "view.missing": "{0} Kapitel fehlen",
  "view.export": "Als EPUB exportieren",
  "view.exportNote": "Notiz als EPUB exportieren",
  "view.editMetadata": "Metadaten bearbeiten",
  "view.makeBook": "Zu Buch machen",
```

- [ ] **Step 2: Run the i18n parity test to confirm EN/DE stay in sync**

Run: `npx vitest run tests/i18n/strings.test.ts`
Expected: PASS — parity holds (both objects got the same 12 keys).

- [ ] **Step 3: Write the failing renderer test**

Create `tests/obsidian/sidebar-render.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts`
Expected: FAIL — "Failed to resolve import ... src/obsidian/sidebar-render".

- [ ] **Step 5: Write the renderer**

Create `src/obsidian/sidebar-render.ts`:

```ts
import { setIcon } from "obsidian";
import { SidebarModel } from "../core/sidebar-model";
import { t } from "../vendor/kit/i18n";

export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
}

function headerTitle(context: SidebarModel["context"]): string {
  if (context === "book") return t("view.context.book");
  if (context === "note") return t("view.context.note");
  return t("view.none.title");
}

// Pure DOM build (mount-once): clears root and rebuilds from the model. Buttons
// are wired to injected handlers so this stays node-testable with the fake el.
export function renderSidebar(root: HTMLElement, model: SidebarModel, handlers: SidebarHandlers): void {
  root.empty();
  root.addClass("epub-exporter-sidebar");

  const header = root.createDiv({ cls: "epub-sb-header" });
  const icon = header.createSpan({ cls: "epub-sb-icon" });
  setIcon(icon, "book");
  header.createSpan({ cls: "epub-sb-title", text: headerTitle(model.context) });

  if (model.context === "none") {
    root.createDiv({ cls: "epub-sb-empty", text: t("view.empty") });
    return;
  }

  root.createDiv({ cls: "epub-sb-subtitle", text: model.title });

  if (model.context === "book") {
    root.createDiv({ cls: "epub-sb-chapters-label", text: t("view.chaptersLabel") });
    const list = root.createEl("ul", { cls: "epub-sb-chapters" });
    for (const ch of model.chapters) {
      const li = list.createEl("li", { cls: "epub-sb-chapter" });
      if (ch.status === "missing") li.addClass("is-missing");
      const status = li.createSpan({ cls: "epub-sb-chapter-status" });
      setIcon(status, ch.status === "ok" ? "check" : "alert-triangle");
      li.createSpan({ cls: "epub-sb-chapter-title", text: ch.title });
    }
    if (model.missingCount > 0) {
      root.createDiv({ cls: "epub-sb-warning", text: t("view.missing", model.missingCount) });
    }

    const exportBtn = root.createEl("button", {
      cls: "epub-sb-btn mod-cta epub-sb-action-export",
      text: t("view.export"),
    });
    exportBtn.addEventListener("click", () => handlers.onExport());
    const metaBtn = root.createEl("button", {
      cls: "epub-sb-btn epub-sb-action-meta",
      text: t("view.editMetadata"),
    });
    metaBtn.addEventListener("click", () => handlers.onInsertFrontmatter());
    return;
  }

  // context === "note"
  const exportBtn = root.createEl("button", {
    cls: "epub-sb-btn mod-cta epub-sb-action-export",
    text: t("view.exportNote"),
  });
  exportBtn.addEventListener("click", () => handlers.onExport());
  const makeBtn = root.createEl("button", {
    cls: "epub-sb-btn epub-sb-action-meta",
    text: t("view.makeBook"),
  });
  makeBtn.addEventListener("click", () => handlers.onInsertFrontmatter());
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/i18n/strings.ts src/obsidian/sidebar-render.ts tests/obsidian/sidebar-render.test.ts
git commit -m "feat(obsidian): pure sidebar DOM renderer + sidebar i18n strings"
```

---

## Task 4: Obsidian shell — `resolveTargetFile`, `EpubHubView`, `buildSnapshot`

The thin Obsidian layer: the gotcha-safe target-file resolver (node-tested), the `ItemView` that re-renders on context change, and the snapshot glue that reads the note + resolves embeds. Also extracts a shared `stripFrontmatter` to keep the body-stripping DRY.

**Files:**
- Modify: `src/core/frontmatter.ts` (export `stripFrontmatter`)
- Modify: `src/obsidian/deps.ts` (use the shared helper)
- Create: `src/obsidian/hub-view.ts`
- Create: `src/obsidian/sidebar-bridge.ts`
- Test: `tests/obsidian/hub-view.test.ts`

**Interfaces:**
- Consumes: `SidebarSnapshot`, `SidebarChapter`, `buildBookChapters`, `buildSidebarModel` (Task 2); `renderSidebar`, `SidebarHandlers` (Task 3); `isBookNote`, `parseBookMetadata`, `stripFrontmatter` (frontmatter); `App`, `ItemView`, `WorkspaceLeaf`, `TFile`, `MarkdownView` from `obsidian`; `t`.
- Produces:
  - `const VIEW_TYPE_EPUB_HUB = "epub-exporter-hub"`
  - `resolveTargetFile(app: App): TFile | null`
  - `interface SidebarBridge { snapshot(): Promise<SidebarSnapshot | null>; handlers: SidebarHandlers }`
  - `class EpubHubView extends ItemView` (ctor `(leaf, bridge)`, `getViewType/getDisplayText/getIcon`, `onOpen`, `onClose`)
  - `buildSnapshot(app: App, defaultLanguage: string): Promise<SidebarSnapshot | null>`
  - `stripFrontmatter(content: string): string` (from `src/core/frontmatter.ts`)

- [ ] **Step 1: Extract the shared `stripFrontmatter` (failing test first)**

Add to `tests/core/frontmatter.test.ts` (append inside the file, at top level after existing imports/describes):

```ts
import { stripFrontmatter } from "../../src/core/frontmatter";

describe("stripFrontmatter", () => {
  it("removes a leading YAML block, keeps body", () => {
    const md = ["---", "epub: true", "title: X", "---", "", "# Body", "text"].join("\n");
    expect(stripFrontmatter(md)).toBe(["", "# Body", "text"].join("\n"));
  });
  it("returns content unchanged when there is no frontmatter", () => {
    expect(stripFrontmatter("# Body only")).toBe("# Body only");
  });
});
```

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: FAIL — `stripFrontmatter` is not exported.

- [ ] **Step 2: Add `stripFrontmatter` to core, make the test pass**

Append to `src/core/frontmatter.ts`:

```ts
// Strip a leading YAML frontmatter block so the body handed to a renderer/parser
// has no raw YAML. Shared by deps.ts (render) and sidebar-bridge.ts (spine read).
export function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (m) return content.slice(m[0].length);
  }
  return content;
}
```

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: PASS.

- [ ] **Step 3: De-duplicate `deps.ts`**

In `src/obsidian/deps.ts`, remove the local `stripFrontmatter` function (lines defining `function stripFrontmatter(content: string): string { ... }`) and import the shared one. Change the import line

```ts
import { extractCodeBlocks } from "../core/code-blocks";
```

to add:

```ts
import { extractCodeBlocks } from "../core/code-blocks";
import { stripFrontmatter } from "../core/frontmatter";
```

Run: `npm run typecheck`
Expected: no errors (the removed local function is now the imported one; call site in `readNote` is unchanged).

Run: `npm test`
Expected: still green — `book-assembler`/`deps` behavior unchanged.

- [ ] **Step 4: Write the failing `resolveTargetFile` test**

Create `tests/obsidian/hub-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, TFile, WorkspaceLeaf } from "../mocks/obsidian";
import { resolveTargetFile } from "../../src/obsidian/hub-view";

function appWithLeaf(leafView: unknown): App {
  return {
    workspace: {
      rootSplit: {},
      getMostRecentLeaf: () => (leafView === null ? null : { view: leafView }),
    },
  } as unknown as App;
}

describe("resolveTargetFile", () => {
  it("returns the file of the most-recent markdown leaf", () => {
    const v = new MarkdownView();
    const f = new TFile();
    f.path = "Book.md";
    v.file = f;
    expect(resolveTargetFile(appWithLeaf(v))?.path).toBe("Book.md");
  });

  it("returns null when the most-recent leaf is not a markdown view", () => {
    expect(resolveTargetFile(appWithLeaf(new WorkspaceLeaf()))).toBeNull();
  });

  it("returns null when there is no leaf", () => {
    expect(resolveTargetFile(appWithLeaf(null))).toBeNull();
  });

  it("returns null when the markdown view has no file", () => {
    expect(resolveTargetFile(appWithLeaf(new MarkdownView()))).toBeNull();
  });
});
```

Run: `npx vitest run tests/obsidian/hub-view.test.ts`
Expected: FAIL — "Failed to resolve import ... src/obsidian/hub-view".

- [ ] **Step 5: Write `hub-view.ts`**

Create `src/obsidian/hub-view.ts`:

```ts
import { App, ItemView, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import { SidebarSnapshot, buildSidebarModel } from "../core/sidebar-model";
import { renderSidebar, SidebarHandlers } from "./sidebar-render";
import { t } from "../vendor/kit/i18n";

export const VIEW_TYPE_EPUB_HUB = "epub-exporter-hub";

// REGISTRY gotcha Z.91: clicking INTO the sidebar makes the panel the active
// view, so getActiveViewOfType(MarkdownView) returns null. Resolve the user's
// real target note via the most-recent MAIN-area leaf instead.
export function resolveTargetFile(app: App): TFile | null {
  const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
  const view = leaf?.view;
  if (view instanceof MarkdownView && view.file) return view.file;
  return null;
}

export interface SidebarBridge {
  snapshot(): Promise<SidebarSnapshot | null>;
  handlers: SidebarHandlers;
}

// Thin ItemView shell around the node-tested model + renderer. Re-renders on
// every active-leaf/file change so the panel always reflects the current note.
export class EpubHubView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private bridge: SidebarBridge) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_EPUB_HUB;
  }
  getDisplayText(): string {
    return t("view.title");
  }
  getIcon(): string {
    return "book";
  }

  async onOpen(): Promise<void> {
    await this.rerender();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.rerender()));
    this.registerEvent(this.app.workspace.on("file-open", () => void this.rerender()));
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async rerender(): Promise<void> {
    const snap = await this.bridge.snapshot();
    renderSidebar(this.contentEl, buildSidebarModel(snap), this.bridge.handlers);
  }
}
```

Run: `npx vitest run tests/obsidian/hub-view.test.ts`
Expected: PASS (4 tests). (`EpubHubView` compiles against the mock's `ItemView`; only `resolveTargetFile` is asserted — the lifecycle is GUI-smoked in Task 5.)

- [ ] **Step 6: Write the snapshot glue**

Create `src/obsidian/sidebar-bridge.ts`:

```ts
import { App, TFile } from "obsidian";
import { SidebarSnapshot, buildBookChapters } from "../core/sidebar-model";
import { isBookNote, parseBookMetadata, stripFrontmatter } from "../core/frontmatter";
import { resolveTargetFile } from "./hub-view";

// Read the current target note and, if it is a book note, resolve its embed
// spine into ok/missing chapters. Cheap: cachedRead + metadataCache lookups,
// no rendering. Returns null when there is no markdown target.
export async function buildSnapshot(app: App, defaultLanguage: string): Promise<SidebarSnapshot | null> {
  const file = resolveTargetFile(app);
  if (!file) return null;

  const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;

  if (isBookNote(fm)) {
    const content = await app.vault.cachedRead(file);
    const body = stripFrontmatter(content);
    const chapters = buildBookChapters(body, (target) => {
      const dest = app.metadataCache.getFirstLinkpathDest(target, file.path);
      if (!(dest instanceof TFile)) return null;
      const destFm = (app.metadataCache.getFileCache(dest)?.frontmatter ?? {}) as Record<string, unknown>;
      const ct = destFm["chapter_title"];
      return { title: typeof ct === "string" && ct ? ct : dest.basename };
    });
    const title = parseBookMetadata(fm, { fallbackTitle: file.basename, defaultLanguage }).title;
    return { kind: "book", title, chapters };
  }

  return { kind: "note", title: file.basename, chapters: [] };
}
```

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/frontmatter.ts src/obsidian/deps.ts src/obsidian/hub-view.ts src/obsidian/sidebar-bridge.ts tests/core/frontmatter.test.ts tests/obsidian/hub-view.test.ts
git commit -m "feat(obsidian): EpubHubView + getMostRecentLeaf resolver + snapshot glue"
```

---

## Task 5: Wire into `main.ts`, styles, opt-in startup, GUI-smoke

Register the view, add an open command, opt-in startup reveal behind `onLayoutReady`, build the bridge over the existing export/frontmatter actions, and ship `styles.css`. Ends with a real-Obsidian GUI-smoke (delivered as a `/user-handover` checklist at execution time).

**Files:**
- Modify: `src/main.ts`
- Create: `styles.css`

**Interfaces:**
- Consumes: `VIEW_TYPE_EPUB_HUB`, `EpubHubView`, `resolveTargetFile`, `SidebarBridge` (Task 4); `buildSnapshot` (Task 4); existing `exportSource`, `insertFrontmatter` (refactored), `settings`, `t`.
- Produces: no new exported symbols (integration only).

- [ ] **Step 1: Refactor `insertFrontmatter` to take an explicit target**

In `src/main.ts`, change the private method `insertFrontmatter()` so it accepts a file. Replace its signature and guard:

Find:

```ts
  private async insertFrontmatter(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
```

Replace with:

```ts
  private async insertFrontmatterFor(file: TFile | null): Promise<void> {
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
```

Then update the existing command callback (the `insert-book-frontmatter` command in `onload`) from:

```ts
    this.addCommand({ id: "insert-book-frontmatter", name: t("cmd.insertFrontmatter"), callback: () => { void this.insertFrontmatter(); } });
```

to:

```ts
    this.addCommand({ id: "insert-book-frontmatter", name: t("cmd.insertFrontmatter"), callback: () => { void this.insertFrontmatterFor(this.app.workspace.getActiveFile()); } });
```

- [ ] **Step 2: Add the view imports**

At the top of `src/main.ts`, extend the imports. Add to the `obsidian` import (it already imports `TFile`, `TFolder`, `Menu`, `getLanguage`, `normalizePath`, `Notice`, `Plugin`) — `WorkspaceLeaf`:

```ts
import { Plugin, Notice, TFile, TFolder, Menu, getLanguage, normalizePath, WorkspaceLeaf } from "obsidian";
```

And add the new module imports (next to the other local imports):

```ts
import { EpubHubView, VIEW_TYPE_EPUB_HUB, resolveTargetFile, SidebarBridge } from "./obsidian/hub-view";
import { buildSnapshot } from "./obsidian/sidebar-bridge";
```

- [ ] **Step 3: Register the view + command + opt-in startup**

In `onload()`, after the existing `this.addSettingTab(...)` line, add:

```ts
    this.registerView(VIEW_TYPE_EPUB_HUB, (leaf: WorkspaceLeaf) => new EpubHubView(leaf, this.makeBridge()));
    this.addCommand({ id: "open-sidebar", name: t("cmd.openSidebar"), callback: () => { void this.openHub(); } });
```

At the very end of `onload()` (after the folder `file-menu` `registerEvent` block), add the opt-in reveal:

```ts
    // Gotcha Z.37: never auto-open unconditionally — gated on the setting and onLayoutReady.
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openSidebarOnStartup) void this.openHub();
    });
```

- [ ] **Step 4: Add the bridge + open helper methods**

Add these three methods to the `EpubExporterPlugin` class (e.g. after `insertFrontmatterFor`):

```ts
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
      },
    };
  }

  async openHub(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_EPUB_HUB);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    if (existing.length === 0) await leaf.setViewState({ type: VIEW_TYPE_EPUB_HUB, active: true });
    void workspace.revealLeaf(leaf);
  }
```

Note: `exportSource` handles a `{ kind: "note" }` source — for a book note it detects `isBookNote` internally and walks the embed spine, so the sidebar's single "Export" path covers both book and single-note contexts (same as the ribbon/command).

- [ ] **Step 5: Create `styles.css`**

Create `styles.css` at the repo root:

```css
/* EPUB Exporter — sidebar (Plan 4). Theme-neutral: leans on Obsidian variables. */
.epub-exporter-sidebar {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.epub-sb-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: var(--font-semibold);
}
.epub-sb-icon {
  display: inline-flex;
  color: var(--text-muted);
}
.epub-sb-title {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.epub-sb-subtitle {
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
}
.epub-sb-empty {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.epub-sb-chapters-label {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-top: 0.2rem;
}
.epub-sb-chapters {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.epub-sb-chapter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-ui-small);
}
.epub-sb-chapter-status {
  display: inline-flex;
  color: var(--text-success);
}
.epub-sb-chapter.is-missing .epub-sb-chapter-status {
  color: var(--text-error);
}
.epub-sb-chapter.is-missing .epub-sb-chapter-title {
  color: var(--text-muted);
  text-decoration: line-through;
}
.epub-sb-warning {
  font-size: var(--font-ui-smaller);
  color: var(--text-error);
}
.epub-sb-btn {
  margin-top: 0.2rem;
}
```

- [ ] **Step 6: Typecheck, build, full suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds, `main.js` regenerated (leave it untracked — gitignored).

Run: `npm test`
Expected: all tests green — **83 (Task 1) + 5 (Task 2) + 5 (Task 3) + 2 frontmatter + 4 hub-view = 99** passing (exact count may vary by ±; the key gate is zero failures).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts styles.css
git commit -m "feat(obsidian): register EPUB sidebar view, open command, opt-in startup + styles"
```

- [ ] **Step 8: GUI-smoke in real Obsidian (deliver as `/user-handover`)**

Install into the Pallas vault plugin folder and verify by hand. Copy the built artifacts:

```bash
cp main.js manifest.json styles.css "/Users/Shared/10_ObsidianVaults/10_Pallas/.obsidian/plugins/epub-exporter/"
```

Then reload the plugin (Obsidian → community plugins → toggle off/on, or reload the app) and confirm against the test book in `10_Pallas/_epub-testing/`:

1. **Open** — run the command *"Open EPUB Exporter sidebar"* → the panel appears in the right sidebar with the book icon + "EPUB Exporter" title.
2. **Book context** — open the test book note → header shows "Book note", subtitle shows the book title, and every `![[embed]]` appears as a chapter row with a green check.
3. **Broken embed** — the deliberately-broken chapter shows a red alert icon + strikethrough, and the "N chapter(s) missing" warning renders.
4. **Context switch** — click into a plain note (not a book) → panel switches to "Note" with *Export note as EPUB* + *Make into a book* buttons, no chapter list. Click into the sidebar itself and back — the export still targets the note (getMostRecentLeaf gotcha holds; no null/empty export).
5. **Export button** — in book context, click *Export as EPUB* → an EPUB is written to the configured destination (verify it opens in Apple Books).
6. **Edit metadata / Make into a book** — click the secondary button → book-frontmatter fields are scaffolded into the target note (existing values untouched).
7. **Opt-in startup** — toggle *Open sidebar on startup* ON in settings, restart Obsidian → the panel auto-reveals. Toggle OFF, restart → it does not.
8. **Mobile sanity (optional)** — if convenient, confirm the panel renders on the Obsidian mobile app (no desktop-only API crash).

Record the result (screenshots + pass/fail per item) in the handover note; on any failure, capture the console and treat it as a Plan-4 carry-forward.

---

## Self-Review

**1. Spec coverage (§5 Sidebar + §5.1 Gotchas):**
- "erkennt automatisch worauf man steht" → `buildSnapshot` + `resolveTargetFile` (Task 4), context in `SidebarModel` (Task 2). ✓
- Book title + chapter list from `![[embeds]]` → `buildBookChapters` (Task 2), rendered rows (Task 3). ✓
- "✓ Embed aufgelöst / ⚠ kaputter Link" → `status: ok/missing` + check/alert-triangle icons + `is-missing` styling (Tasks 2/3/5). ✓
- "[Als EPUB exportieren]" / "[Metadaten bearbeiten]" (book) and "[Note als EPUB]" / "[Zu Buch machen]" (note) → `renderSidebar` both branches + `SidebarHandlers` wired to `exportSource`/`insertFrontmatterFor` (Tasks 3/5). ✓
- Gotcha Z.91 (`getMostRecentLeaf`, not `getActiveViewOfType`) → `resolveTargetFile`, node-tested (Task 4). ✓
- Gotcha Z.37 (opt-in `openSidebarOnStartup` behind `onLayoutReady`) → Task 5 Step 3; setting already exists. ✓
- Phase-1 scope only (no Consolidate/Import buttons, no drag-reorder) → matches §5 phase table row 1. Phases 2–3 hang off the same single panel later. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N"/"write tests for the above". Every code step shows complete code; every test step shows full assertions. ✓

**3. Type consistency:**
- `SidebarSnapshot`/`SidebarChapter`/`SidebarModel` defined once (Task 2), consumed unchanged in Tasks 3/4. ✓
- `SidebarHandlers { onExport; onInsertFrontmatter }` defined Task 3, implemented Task 5's `makeBridge`. ✓
- `resolveTargetFile(app): TFile | null` — same signature Task 4 (def/test) and Task 5 (call sites). ✓
- `buildSnapshot(app, defaultLanguage)` — Task 4 def, Task 5 `makeBridge` call. ✓
- `VIEW_TYPE_EPUB_HUB` — one const, used in `hub-view.ts` + `main.ts`. ✓
- `stripFrontmatter` — exported from `frontmatter.ts` (Task 4), imported by `deps.ts` + `sidebar-bridge.ts`. ✓
- DOM class names in `renderSidebar` (Task 3) all have matching `styles.css` rules (Task 5). ✓

No gaps found.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-epub-exporter-phase1-plan4-sidebar.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
