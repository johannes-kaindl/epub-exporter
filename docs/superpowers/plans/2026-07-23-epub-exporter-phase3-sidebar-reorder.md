# Phase 3 — Kapitel-Sortierung in der Sidebar: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kapitelliste der Sidebar wird per Ziehen und `Alt+↑/↓` sortierbar; die neue Reihenfolge wird sofort in den `![[embed]]`-Spine der Buch-Notiz zurückgeschrieben.

**Architecture:** Drei Schichten wie gehabt. Eine neue reine Funktion `reorderSpine` permutiert die **rohen** Embed-Zeilen zwischen ihren bestehenden Positionen (niemals neu erzeugen — sonst gehen Alias und Heading verloren). Der Renderer meldet Sortierwünsche über injizierte Handler, die Ansicht schiebt Neuaufbauten während einer Geste auf, und `main.ts` schreibt atomar via `vault.process`. Die Datei bleibt die einzige Wahrheitsquelle: Das Panel sortiert sich nie optimistisch selbst um.

**Tech Stack:** TypeScript · esbuild · vitest · Obsidian-API (`vault.process`, `metadataCache`) · vendored Kit-i18n · natives HTML5-Drag-and-Drop.

**Spec:** `docs/superpowers/specs/2026-07-23-epub-exporter-phase3-sidebar-reorder-design.md`

## Global Constraints

- **Keine `obsidian`-Importe** in `src/core/` und `src/vendor/` — erzwungen von `npm run check:pure`.
- **Kein Inline-`// eslint-disable`** in `src/` — erzwungen von `scripts/check-no-inline-disables.mjs`; genuine Ausnahmen nur file-scoped in `eslint.config.mjs` mit Begründung.
- **`minAppVersion` ist `1.8.7`** — nur APIs verwenden, die es dort gibt. `vault.process` ist `@since 1.1.0` und damit erlaubt. **Kein** `app.dragManager` (undokumentierte Interna, `obsidianmd/no-unsupported-api` ist **Error**).
- **i18n zweisprachig**: Jeder neue Schlüssel muss in `EN` **und** `DE` in `src/i18n/strings.ts` stehen — ein Parity-Test hält die Schlüsselmengen gleich.
- **CSS nur über Theme-Variablen** (`var(--…)`), gemäß `../UI-STANDARD.md`. Keine festen Farben.
- **`main.js` ist Build-Artefakt** und wird **nicht** committet. `styles.css` **wird** committet.
- **Conventional Commits**; nur berührte Dateien stagen.
- Vor jedem Commit läuft mindestens `npm test`; am Ende des Plans einmal `npm run gate`.
- Branch: `phase3-sidebar-reorder` (existiert bereits, enthält den Spec-Commit).

---

### Task 1: Reine Umsortier-Funktion `reorderSpine`

Das Herzstück. Die Regel „was ist eine Kapitelzeile" wird aus `spine-parser.ts` exportiert, damit Anzeige, Export und Sortierung sich niemals uneinig sein können.

**Files:**
- Modify: `src/core/spine-parser.ts`
- Create: `src/core/spine-reorder.ts`
- Test: `tests/core/spine-reorder.test.ts`

**Interfaces:**
- Consumes: nichts (erste Task).
- Produces:
  - `matchEmbedLine(rawLine: string): string | null` aus `src/core/spine-parser.ts`
  - `reorderSpine(body: string, from: number, to: number, expectedCount: number): ReorderResult` aus `src/core/spine-reorder.ts`
  - `type ReorderResult = { ok: true; body: string } | { ok: false; reason: "noop" | "out-of-range" | "conflict" }`

- [ ] **Step 1: Die Zeilenregel aus `spine-parser.ts` exportieren**

Ersetze in `src/core/spine-parser.ts` die Funktion `parseEmbedSpine` samt Regex-Konstante durch:

```ts
export interface SpineEntry {
  target: string; // link target inside ![[ ]], without alias/heading
}

// A chapter is a line whose *entire* trimmed content is a single embed.
const TOP_LEVEL_EMBED = /^!\[\[([^\]]+)\]\]$/;

// The single definition of "this line is a chapter", shared with spine-reorder.ts.
// Two divergent copies would let the sidebar, the export and the reordering
// disagree about which lines are chapters — a correctness hazard, not a style one.
// Returns the link target, or null when the line is not a chapter line.
export function matchEmbedLine(rawLine: string): string | null {
  const m = rawLine.trim().match(TOP_LEVEL_EMBED);
  if (!m) return null;
  const target = m[1].split("|")[0].split("#")[0].trim();
  return target || null;
}

export function parseEmbedSpine(body: string): SpineEntry[] {
  const entries: SpineEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const target = matchEmbedLine(rawLine);
    if (target) entries.push({ target });
  }
  return entries;
}
```

Die Funktion `sortFolderChapters` darunter bleibt unverändert.

- [ ] **Step 2: Bestehende Spine-Tests laufen lassen (Regressionsschutz)**

Run: `npx vitest run tests/core/spine-parser.test.ts`
Expected: PASS — reines Refactoring, kein Verhalten geändert.

- [ ] **Step 3: Die fehlschlagenden Tests schreiben**

Create `tests/core/spine-reorder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reorderSpine } from "../../src/core/spine-reorder";

const BODY = ["# Buch", "", "![[Vorwort]]", "![[Kapitel 1]]", "![[Kapitel 2]]", "", "Nachwort-Prosa"].join("\n");

function bodyOf(res: ReturnType<typeof reorderSpine>): string {
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}`);
  return res.body;
}

describe("reorderSpine", () => {
  it("moves a chapter down", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 2, 3));
    expect(out.split("\n").slice(2, 5)).toEqual(["![[Kapitel 1]]", "![[Kapitel 2]]", "![[Vorwort]]"]);
  });

  it("moves a chapter up", () => {
    const out = bodyOf(reorderSpine(BODY, 2, 0, 3));
    expect(out.split("\n").slice(2, 5)).toEqual(["![[Kapitel 2]]", "![[Vorwort]]", "![[Kapitel 1]]"]);
  });

  it("preserves an alias — the whole point of moving raw lines", () => {
    const body = ["![[Kapitel 1|Vorwort]]", "![[Kapitel 2]]"].join("\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[Kapitel 2]]", "![[Kapitel 1|Vorwort]]"].join("\n"));
  });

  it("preserves a heading suffix", () => {
    const body = ["![[Kapitel 1#Teil A]]", "![[Kapitel 2]]"].join("\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[Kapitel 2]]", "![[Kapitel 1#Teil A]]"].join("\n"));
  });

  it("leaves prose between chapters exactly where it was", () => {
    const body = ["![[A]]", "Zwischentext", "![[B]]"].join("\n");
    // Only the two embed slots swap; "Zwischentext" keeps its line.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "Zwischentext", "![[A]]"].join("\n"));
  });

  it("leaves leading and trailing prose untouched", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 1, 3));
    const lines = out.split("\n");
    expect(lines[0]).toBe("# Buch");
    expect(lines[1]).toBe("");
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("Nachwort-Prosa");
  });

  it("keeps the line count identical", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 2, 3));
    expect(out.split("\n")).toHaveLength(BODY.split("\n").length);
  });

  it("preserves CRLF line endings", () => {
    const body = ["![[A]]", "![[B]]"].join("\r\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "![[A]]"].join("\r\n"));
  });

  it("handles indented embed lines", () => {
    const body = ["  ![[A]]", "![[B]]"].join("\n");
    // The raw line moves verbatim, indentation and all.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "  ![[A]]"].join("\n"));
  });

  it("reports noop when the chapter is dropped on itself", () => {
    expect(reorderSpine(BODY, 1, 1, 3)).toEqual({ ok: false, reason: "noop" });
  });

  it("reports conflict when the note gained a chapter behind our back", () => {
    // Panel showed 2 chapters, the file now has 3 → indices are meaningless.
    expect(reorderSpine(BODY, 0, 1, 2)).toEqual({ ok: false, reason: "conflict" });
  });

  it("reports out-of-range for an index past the end", () => {
    expect(reorderSpine(BODY, 0, 3, 3)).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("ignores embed-looking text that is not a whole line", () => {
    const body = ["Siehe ![[A]] dort", "![[B]]", "![[C]]"].join("\n");
    // Only B and C are chapters; expectedCount is therefore 2.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["Siehe ![[A]] dort", "![[C]]", "![[B]]"].join("\n"));
  });
});
```

- [ ] **Step 4: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/core/spine-reorder.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/spine-reorder"`.

- [ ] **Step 5: `reorderSpine` implementieren**

Create `src/core/spine-reorder.ts`:

```ts
import { matchEmbedLine } from "./spine-parser";

export type ReorderResult =
  | { ok: true; body: string }
  | { ok: false; reason: "noop" | "out-of-range" | "conflict" };

// Reorder the embed spine by MOVING RAW LINES between their existing slots.
//
// Never rebuild an embed line from a parsed target: parseEmbedSpine drops alias
// and heading (`![[A|Alias]]` → "A"), so regenerating would silently destroy
// them — the same bug class the Phase-2 review caught in rewriteImageRefs.
// Because only the *contents* of the embed slots are permuted, everything else
// (prose, headings, blank lines, indentation) stays byte-identical and the line
// count is unchanged.
//
// `expectedCount` is the conflict guard: it is the number of chapters the panel
// was showing. If the file disagrees at write time, someone edited the note in
// between and the caller's indices no longer mean anything.
export function reorderSpine(
  body: string,
  from: number,
  to: number,
  expectedCount: number
): ReorderResult {
  if (from === to) return { ok: false, reason: "noop" };

  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  const slots: number[] = [];
  lines.forEach((line, i) => {
    if (matchEmbedLine(line) !== null) slots.push(i);
  });

  if (slots.length !== expectedCount) return { ok: false, reason: "conflict" };
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) {
    return { ok: false, reason: "out-of-range" };
  }

  const raw = slots.map((i) => lines[i]);
  const [moved] = raw.splice(from, 1);
  raw.splice(to, 0, moved);
  slots.forEach((lineIndex, slot) => {
    lines[lineIndex] = raw[slot];
  });

  return { ok: true, body: lines.join(eol) };
}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `npx vitest run tests/core/spine-reorder.test.ts tests/core/spine-parser.test.ts`
Expected: PASS (13 neue + die bestehenden Spine-Tests).

- [ ] **Step 7: Reinheit prüfen und committen**

Run: `npm run check:pure && npm run typecheck`
Expected: beide ohne Ausgabe/Fehler.

```bash
git add src/core/spine-parser.ts src/core/spine-reorder.ts tests/core/spine-reorder.test.ts
git commit -m "feat(core): reorderSpine permutiert rohe Embed-Zeilen

Bewegt die unveraenderten Zeilen zwischen ihren Slots, statt sie aus
geparsten Zielen neu zu bauen - damit ueberleben Alias und Heading
strukturell. Die Zeilenregel wandert als matchEmbedLine in den
spine-parser, damit Anzeige, Export und Sortierung dieselbe Definition
von Kapitel benutzen."
```

---

### Task 2: `splitFrontmatter` — Kopf und Body trennbar machen

Die Kapitel-Indizes der Sidebar zählen im Body **ohne** Frontmatter. Der Schreibpfad muss deshalb denselben Schnitt machen und danach wieder zusammensetzen. (Ein YAML-Blockwert kann eine Zeile enthalten, die wie ein Embed aussieht — auf dem vollen Dateiinhalt zu zählen ergäbe dann dauerhaft `conflict`.)

**Files:**
- Modify: `src/core/frontmatter.ts:95-101`
- Test: `tests/core/frontmatter.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `splitFrontmatter(content: string): { head: string; body: string }` aus `src/core/frontmatter.ts`. Es gilt stets `head + body === content`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ergänze in `tests/core/frontmatter.test.ts` am Dateiende (und ergänze `splitFrontmatter` im bestehenden Import aus `../../src/core/frontmatter`):

```ts
describe("splitFrontmatter", () => {
  it("splits a note into frontmatter head and body", () => {
    const content = "---\ntitle: X\n---\n# Heading\nText";
    const { head, body } = splitFrontmatter(content);
    expect(head).toBe("---\ntitle: X\n---\n");
    expect(body).toBe("# Heading\nText");
  });

  it("returns an empty head when there is no frontmatter", () => {
    const { head, body } = splitFrontmatter("# Just a heading");
    expect(head).toBe("");
    expect(body).toBe("# Just a heading");
  });

  it("always recomposes to the original content", () => {
    for (const c of ["---\na: 1\n---\nbody", "no frontmatter", "---\nunterminated\nbody"]) {
      const { head, body } = splitFrontmatter(c);
      expect(head + body).toBe(c);
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: FAIL — `splitFrontmatter is not a function` bzw. TS-Fehler beim Import.

- [ ] **Step 3: Implementieren**

Ersetze in `src/core/frontmatter.ts` die Funktion `stripFrontmatter` (Zeilen 93–101) durch:

```ts
// Split a note into its leading YAML frontmatter block and the remaining body.
// head + body always recomposes to the input, so a writer can put the note back
// together after rewriting only the body.
export function splitFrontmatter(content: string): { head: string; body: string } {
  if (content.startsWith("---")) {
    const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (m) return { head: m[0], body: content.slice(m[0].length) };
  }
  return { head: "", body: content };
}

// Strip a leading YAML frontmatter block so the body handed to a renderer/parser
// has no raw YAML. Shared by deps.ts (render) and sidebar-bridge.ts (spine read).
export function stripFrontmatter(content: string): string {
  return splitFrontmatter(content).body;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: PASS — neue Tests grün, bestehende `stripFrontmatter`-Tests unverändert grün.

- [ ] **Step 5: Committen**

Run: `npm test`
Expected: alle Suiten grün.

```bash
git add src/core/frontmatter.ts tests/core/frontmatter.test.ts
git commit -m "refactor(core): splitFrontmatter trennt Kopf und Body

stripFrontmatter delegiert jetzt dorthin. Der Schreibpfad der
Kapitelsortierung braucht den Kopf, um die Notiz nach dem Umsortieren
des Bodys wieder korrekt zusammenzusetzen."
```

---

### Task 3: `canReorder` im Sidebar-Modell

**Files:**
- Modify: `src/core/sidebar-model.ts:20-51`
- Test: `tests/core/sidebar-model.test.ts`
- Modify (mechanisch): `tests/obsidian/sidebar-render.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `SidebarModel` hat zusätzlich das Pflichtfeld `canReorder: boolean` — `true` genau dann, wenn `context === "book"` und mehr als ein Kapitel vorhanden ist.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ergänze in `tests/core/sidebar-model.test.ts` am Dateiende:

```ts
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
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/core/sidebar-model.test.ts`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Implementieren**

Ersetze in `src/core/sidebar-model.ts` das Interface `SidebarModel` und die Funktion `buildSidebarModel` (Zeilen 20–25 bzw. 42–51) durch:

```ts
export interface SidebarModel {
  context: SidebarContext;
  title: string;
  chapters: SidebarChapter[];
  missingCount: number;
  // Reordering needs at least two chapters to mean anything; the renderer uses
  // this to decide whether rows get drag handles at all.
  canReorder: boolean;
}
```

```ts
export function buildSidebarModel(snap: SidebarSnapshot | null): SidebarModel {
  if (!snap || snap.kind === "none") {
    return { context: "none", title: "", chapters: [], missingCount: 0, canReorder: false };
  }
  if (snap.kind === "note") {
    return { context: "note", title: snap.title, chapters: [], missingCount: 0, canReorder: false };
  }
  const missingCount = snap.chapters.filter((c) => c.status === "missing").length;
  return {
    context: "book",
    title: snap.title,
    chapters: snap.chapters,
    missingCount,
    canReorder: snap.chapters.length > 1,
  };
}
```

- [ ] **Step 4: Bestehende Renderer-Testliterale nachziehen**

`canReorder` ist ein Pflichtfeld — die Modell-Literale in `tests/obsidian/sidebar-render.test.ts` erzeugen sonst TS-Fehler. Ergänze `canReorder` in **jedem** dort konstruierten `SidebarModel`-Literal: `canReorder: false` überall, **außer** im ersten Test („renders one row per chapter"), der zwei Kapitel hat — dort `canReorder: true`.

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 5: Tests laufen lassen und committen**

Run: `npm test`
Expected: alle Suiten grün.

```bash
git add src/core/sidebar-model.ts tests/core/sidebar-model.test.ts tests/obsidian/sidebar-render.test.ts
git commit -m "feat(core): canReorder im Sidebar-Modell

Sagt dem Renderer, ob Ziehgriffe ueberhaupt sinnvoll sind - bei einem
einzigen Kapitel gibt es nichts umzusortieren."
```

---

### Task 4: Vertikale Scheibe — Ziehen schreibt in die Buch-Notiz

Renderer, Ansicht und Verdrahtung hängen über den `SidebarHandlers`-Typ zusammen; einzeln geändert wäre der Build zwischen den Tasks rot. Diese Task ist deshalb die kleinste Einheit, die grün endet **und** von Hand erlebbar ist: Ziehen funktioniert danach vollständig. Die Tastaturbedienung folgt in Task 5.

**Files:**
- Modify: `tests/mocks/obsidian.ts` (Test-Infrastruktur für Drag-Ereignisse)
- Modify: `src/obsidian/sidebar-render.ts`
- Modify: `src/obsidian/hub-view.ts`
- Modify: `src/main.ts:278-295`
- Modify: `src/i18n/strings.ts`
- Modify: `styles.css`
- Test: `tests/obsidian/sidebar-render.test.ts`, `tests/obsidian/hub-view.test.ts`

**Interfaces:**
- Consumes: `reorderSpine`/`ReorderResult` (Task 1), `splitFrontmatter` (Task 2), `model.canReorder` (Task 3).
- Produces:
  - `SidebarHandlers` (in `sidebar-render.ts`) erhält `onReorder(from: number, to: number, expectedCount: number): void`, `onDragStart(): void`, `onDragEnd(): void`.
  - `SidebarBridge.handlers` (in `hub-view.ts`) ist `Omit<SidebarHandlers, "onDragStart" | "onDragEnd">` — die Gesten-Handler stellt die Ansicht selbst, weil die Sperre ihr Zustand ist.
  - `FakeEl` bekommt `draggable`, `dispatch(event, payload)` und `focus()`.

- [ ] **Step 1: Den Test-Mock um Ereignisse und Drag erweitern**

Ersetze in `tests/mocks/obsidian.ts` den Listener-/Klick-Block der Klasse `FakeEl` (Zeilen 13 sowie 65–73) und ergänze die Drag-/Fokus-Felder. Konkret: ersetze die Zeile

```ts
  private listeners: Record<string, Array<() => void>> = {};
```

durch

```ts
  private listeners: Record<string, Array<(ev: FakeEvent) => void>> = {};
  draggable = false;
  focusCount = 0;
```

und ersetze den Block `addEventListener` / `set onclick` / `click` durch:

```ts
  addEventListener(ev: string, fn: (ev: FakeEvent) => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  set onclick(fn: (ev: FakeEvent) => void) {
    this.listeners["click"] = [fn];
  }

  // ── test-only event plumbing (not part of Obsidian's API) ────────────────
  dispatch(ev: string, payload: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...payload,
    };
    for (const fn of this.listeners[ev] ?? []) fn(e);
    return e;
  }
  click(): void {
    this.dispatch("click");
  }
  focus(): void {
    this.focusCount++;
  }
```

Ergänze oberhalb der Klasse `FakeEl` den Ereignistyp:

```ts
// Minimal stand-in for the DOM events the sidebar listens to. Only the members
// the renderer actually touches — enough to drive drag and keyboard handlers.
export interface FakeEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  altKey?: boolean;
  key?: string;
  dataTransfer?: { effectAllowed: string; setData(format: string, data: string): void };
}
```

- [ ] **Step 2: Mock-Regressionstest laufen lassen**

Run: `npx vitest run tests/obsidian/obsidian-mock.test.ts tests/obsidian/sidebar-render.test.ts`
Expected: PASS — `click()` läuft weiterhin über die Listener, bestehende Tests bleiben grün.

- [ ] **Step 3: Die fehlschlagenden Renderer-Tests schreiben**

Ergänze in `tests/obsidian/sidebar-render.test.ts`. Passe zuerst die gemeinsame `noop`-Konstante oben in der Datei an:

```ts
const noop = {
  onExport: () => {},
  onInsertFrontmatter: () => {},
  onConsolidate: () => {},
  onReorder: () => {},
  onDragStart: () => {},
  onDragEnd: () => {},
};
```

Dann am Dateiende ergänzen:

```ts
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
```

- [ ] **Step 4: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts`
Expected: FAIL — die neuen Tests scheitern (kein `epub-sb-chapter-grip`, `draggable` bleibt `false`, `onReorder` wird nie gerufen).

- [ ] **Step 5: Den Renderer umbauen**

Ersetze in `src/obsidian/sidebar-render.ts` das Interface `SidebarHandlers` (Zeilen 5–9) durch:

```ts
export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
  onConsolidate(): void;
  // `expectedCount` travels with the request so the writer can detect that the
  // note changed behind the panel's back without re-reading it first.
  onReorder(from: number, to: number, expectedCount: number): void;
  onDragStart(): void;
  onDragEnd(): void;
}
```

Ersetze den Kapitellisten-Block innerhalb von `renderSidebar` (Zeilen 36–47, von `root.createDiv({ cls: "epub-sb-chapters-label" …` bis einschließlich des `missingCount`-Blocks) durch:

```ts
    root.createDiv({ cls: "epub-sb-chapters-label", text: t("view.chaptersLabel") });
    const list = root.createEl("ul", { cls: "epub-sb-chapters" });

    // Source index of the row currently being dragged. Kept in this closure
    // rather than in dataTransfer: it survives without any DOM round-trip and
    // keeps the handlers node-testable.
    let dragFrom: number | null = null;
    const rows: HTMLElement[] = [];
    const clearMarks = (): void => {
      for (const el of rows) {
        el.removeClass("is-dragging");
        el.removeClass("is-drop-target");
      }
    };

    model.chapters.forEach((ch, index) => {
      const li = list.createEl("li", { cls: "epub-sb-chapter" });
      rows.push(li);
      if (ch.status === "missing") li.addClass("is-missing");

      if (model.canReorder) {
        li.draggable = true;
        li.setAttribute("tabindex", "0");
        const grip = li.createSpan({
          cls: "epub-sb-chapter-grip",
          attr: { "aria-hidden": "true", title: t("view.dragHint") },
        });
        setIcon(grip, "grip-vertical");
      }

      const status = li.createSpan({ cls: "epub-sb-chapter-status" });
      setIcon(status, ch.status === "ok" ? "check" : "alert-triangle");
      li.createSpan({ cls: "epub-sb-chapter-title", text: ch.title });

      if (!model.canReorder) return;

      li.addEventListener("dragstart", (e) => {
        dragFrom = index;
        li.addClass("is-dragging");
        // Firefox refuses to start a drag unless some data is set.
        const dt = (e as DragEvent).dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          dt.setData("text/plain", String(index));
        }
        handlers.onDragStart();
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault(); // without this the drop event never fires
        if (dragFrom !== null && dragFrom !== index) li.addClass("is-drop-target");
      });
      li.addEventListener("dragleave", () => li.removeClass("is-drop-target"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = dragFrom;
        dragFrom = null;
        clearMarks();
        if (from !== null && from !== index) handlers.onReorder(from, index, model.chapters.length);
      });
      li.addEventListener("dragend", () => {
        dragFrom = null;
        clearMarks();
        handlers.onDragEnd();
      });
    });

    if (model.missingCount > 0) {
      root.createDiv({ cls: "epub-sb-warning", text: t("view.missing", model.missingCount) });
    }
```

- [ ] **Step 6: Den i18n-Schlüssel für den Ziehhinweis ergänzen**

In `src/i18n/strings.ts`, im `EN`-Objekt bei den `view.*`-Schlüsseln:

```ts
  "view.dragHint": "Drag to reorder · Alt+↑/↓",
```

und im `DE`-Objekt an gleicher Stelle:

```ts
  "view.dragHint": "Ziehen zum Sortieren · Alt+↑/↓",
```

- [ ] **Step 7: Renderer-Tests laufen lassen**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts tests/i18n`
Expected: PASS — inklusive Parity-Test für den neuen Schlüssel.

- [ ] **Step 8: Den Gesten-Sperre-Test für die Ansicht schreiben**

Ergänze in `tests/obsidian/hub-view.test.ts` am Dateiende:

```ts
describe("EpubHubView · Neuaufbau waehrend einer Geste", () => {
  function viewWith(snaps: SidebarSnapshot[]) {
    let i = 0;
    const bridge = {
      snapshot: async () => snaps[Math.min(i++, snaps.length - 1)],
      handlers: {
        onExport: () => {},
        onInsertFrontmatter: () => {},
        onConsolidate: () => {},
        onReorder: () => {},
      },
    };
    return new EpubHubView(new WorkspaceLeaf() as never, bridge);
  }
  const priv = (v: EpubHubView) =>
    v as unknown as { rerender: () => Promise<void>; setDragging: (a: boolean) => void };

  it("defers a rebuild while a drag is in flight and runs it once afterwards", async () => {
    const view = viewWith([
      { kind: "book", title: "B", chapters: [{ title: "A", status: "ok" }] },
      { kind: "book", title: "B", chapters: [{ title: "Z", status: "ok" }] },
    ]);
    await priv(view).rerender();
    const before = (view.contentEl as unknown as { children: unknown[] }).children;

    priv(view).setDragging(true);
    await priv(view).rerender(); // must not touch the DOM under the pointer
    expect((view.contentEl as unknown as { children: unknown[] }).children).toBe(before);

    priv(view).setDragging(false);
    await Promise.resolve(); // the deferred rerender is scheduled, not awaited
    await Promise.resolve();
    expect((view.contentEl as unknown as { children: unknown[] }).children).not.toBe(before);
  });
});
```

- [ ] **Step 9: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/hub-view.test.ts`
Expected: FAIL — `setDragging is not a function`.

- [ ] **Step 10: Die Ansicht um Sperre und Handler-Komposition erweitern**

In `src/obsidian/hub-view.ts`: Ergänze den Import um `SidebarHandlers`:

```ts
import { renderSidebar, SidebarHandlers } from "./sidebar-render";
```

Ersetze das Interface `SidebarBridge` (Zeilen 18–21) durch:

```ts
export interface SidebarBridge {
  snapshot(): Promise<SidebarSnapshot | null>;
  // The gesture handlers are supplied by the view, not by the plugin: the drag
  // lock is view state, so main.ts has no business knowing about it.
  handlers: Omit<SidebarHandlers, "onDragStart" | "onDragEnd">;
}
```

Ergänze in der Klasse `EpubHubView` unterhalb von `lastModelKey`:

```ts
  // A rebuild during an in-flight drag would destroy the element under the
  // pointer mid-gesture — the same failure mode that made buttons need two
  // clicks in Plan 4. Requests arriving while locked are deferred, not dropped.
  private dragging = false;
  private pendingRerender = false;
```

Ergänze als private Methode:

```ts
  private setDragging(active: boolean): void {
    this.dragging = active;
    if (!active && this.pendingRerender) {
      this.pendingRerender = false;
      void this.rerender();
    }
  }
```

Ersetze in `rerender` den Kopf und den Renderaufruf. Direkt nach `private async rerender(): Promise<void> {` einfügen:

```ts
    if (this.dragging) {
      this.pendingRerender = true;
      return;
    }
```

und die Zeile `renderSidebar(this.contentEl, model, this.bridge.handlers);` ersetzen durch:

```ts
    const handlers: SidebarHandlers = {
      ...this.bridge.handlers,
      onDragStart: () => this.setDragging(true),
      onDragEnd: () => this.setDragging(false),
    };
    renderSidebar(this.contentEl, model, handlers);
```

- [ ] **Step 11: Den Schreibpfad in `main.ts` verdrahten**

Ergänze die Importe in `src/main.ts`:

```ts
import { reorderSpine } from "./core/spine-reorder";
import { BOOK_FRONTMATTER_TEMPLATE, isBookNote, splitFrontmatter } from "./core/frontmatter";
```

(Die letzte Zeile ersetzt den bestehenden `frontmatter`-Import in Zeile 19.)

Ergänze in `makeBridge()` innerhalb von `handlers` nach `onConsolidate`:

```ts
        onReorder: (from, to, expectedCount) => { void this.reorderChapters(from, to, expectedCount); },
```

Ergänze als neue Methode direkt unterhalb von `makeBridge()`:

```ts
  // Write the new chapter order straight into the book note's embed spine.
  // Atomic via vault.process: the note is typically open in the editor while the
  // user drags, so read-then-write would risk clobbering an edit made in between.
  private async reorderChapters(from: number, to: number, expectedCount: number): Promise<void> {
    const file = resolveTargetFile(this.app);
    if (!file) { new Notice(t("notice.noActiveNote")); return; }

    let conflict = false;
    try {
      await this.app.vault.process(file, (data) => {
        // Indices count chapters in the body only — a YAML block value could
        // otherwise contribute a line that looks exactly like an embed.
        const { head, body } = splitFrontmatter(data);
        const res = reorderSpine(body, from, to, expectedCount);
        if (res.ok) return head + res.body;
        if (res.reason === "conflict") conflict = true;
        return data; // noop and out-of-range leave the file untouched
      });
    } catch (e) {
      console.error("EPUB Exporter: chapter reorder failed", e);
      new Notice(t("notice.reorderFailed"));
      return;
    }
    if (conflict) new Notice(t("notice.reorderConflict"));
  }
```

- [ ] **Step 12: Die beiden Notice-Schlüssel ergänzen**

In `src/i18n/strings.ts`, im `EN`-Objekt bei den `notice.*`-Schlüsseln (alphabetisch einsortiert):

```ts
  "notice.reorderConflict": "The book note changed in the meantime — chapter order was not applied.",
  "notice.reorderFailed": "Could not save the new chapter order — see console for details.",
```

und im `DE`-Objekt an gleicher Stelle:

```ts
  "notice.reorderConflict": "Die Buch-Notiz wurde zwischenzeitlich geändert — die Reihenfolge wurde nicht übernommen.",
  "notice.reorderFailed": "Die neue Kapitelreihenfolge konnte nicht gespeichert werden — Details in der Konsole.",
```

- [ ] **Step 13: Die Ziehoptik ergänzen**

Ergänze am Ende von `styles.css`:

```css
.epub-sb-chapter-grip {
  display: flex;
  align-items: center;
  color: var(--text-faint);
  cursor: grab;
}

.epub-sb-chapter[draggable="true"]:active {
  cursor: grabbing;
}

.epub-sb-chapter.is-dragging {
  opacity: 0.5;
}

.epub-sb-chapter.is-drop-target {
  border-top: 2px solid var(--interactive-accent);
}

.epub-sb-chapter:focus-visible {
  outline: 1px solid var(--interactive-accent);
  outline-offset: -1px;
}
```

- [ ] **Step 14: Alles laufen lassen**

Run: `npm run typecheck && npm test`
Expected: alle Suiten grün, keine TS-Fehler.

- [ ] **Step 15: Committen**

```bash
git add tests/mocks/obsidian.ts src/obsidian/sidebar-render.ts src/obsidian/hub-view.ts src/main.ts src/i18n/strings.ts styles.css tests/obsidian/sidebar-render.test.ts tests/obsidian/hub-view.test.ts
git commit -m "feat(sidebar): Kapitel per Ziehen umsortieren

Ziehgriffe an den Kapitelzeilen, Drop schreibt die neue Reihenfolge
atomar via vault.process in den Embed-Spine. Die Ansicht schiebt
Neuaufbauten waehrend einer laufenden Geste auf, damit das gezogene
Element nicht unter dem Zeiger verschwindet.

Die Datei bleibt die einzige Wahrheitsquelle - das Panel sortiert sich
nicht optimistisch selbst um, sondern zeigt nach dem Schreiben, was
tatsaechlich in der Notiz steht."
```

---

### Task 5: Tastaturbedienung `Alt+↑/↓` samt Fokus-Wiederherstellung

Ohne Fokus-Wiederherstellung bräche wiederholtes `Alt+↑` nach dem ersten Druck ab: Der Neuaufbau ersetzt das DOM und damit die fokussierte Zeile.

**Files:**
- Modify: `src/obsidian/sidebar-render.ts`
- Modify: `src/obsidian/hub-view.ts`
- Test: `tests/obsidian/sidebar-render.test.ts`

**Interfaces:**
- Consumes: `SidebarHandlers.onReorder` (Task 4), `FakeEl.dispatch`/`focus` (Task 4).
- Produces: `renderSidebar(root, model, handlers, focusIndex?: number | null)` — der vierte Parameter fokussiert nach dem Aufbau die Zeile an dieser Position.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

Ergänze in `tests/obsidian/sidebar-render.test.ts` am Dateiende:

```ts
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
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts`
Expected: FAIL — `keydown` löst nichts aus, `focusCount` bleibt 0.

- [ ] **Step 3: Tastatur und Fokus im Renderer ergänzen**

Ändere in `src/obsidian/sidebar-render.ts` die Signatur:

```ts
export function renderSidebar(
  root: HTMLElement,
  model: SidebarModel,
  handlers: SidebarHandlers,
  focusIndex: number | null = null
): void {
```

Ergänze innerhalb der `model.chapters.forEach`-Schleife, direkt nach dem `dragend`-Listener:

```ts
      li.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (!ke.altKey) return;
        if (ke.key === "ArrowUp" && index > 0) {
          ke.preventDefault();
          handlers.onReorder(index, index - 1, model.chapters.length);
        } else if (ke.key === "ArrowDown" && index < model.chapters.length - 1) {
          ke.preventDefault();
          handlers.onReorder(index, index + 1, model.chapters.length);
        }
      });
```

Ergänze unmittelbar nach dem Ende der `forEach`-Schleife (vor dem `missingCount`-Block):

```ts
    // The rebuild replaced the DOM, so the row the user was on is gone. Restore
    // focus, otherwise a second Alt+Arrow press would have nothing to act on.
    if (focusIndex !== null) rows[focusIndex]?.focus();
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/obsidian/sidebar-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Die Ansicht die Zielposition merken lassen**

In `src/obsidian/hub-view.ts`: Ergänze bei den privaten Feldern:

```ts
  // Row to focus after the next rebuild — set for keyboard moves only, so a
  // drag never steals focus away from wherever the user was working.
  private focusIndex: number | null = null;
```

Ersetze das in Step 10 von Task 4 eingefügte `handlers`-Objekt in `rerender` durch:

```ts
    const handlers: SidebarHandlers = {
      ...this.bridge.handlers,
      onReorder: (from, to, expectedCount) => {
        if (!this.dragging) this.focusIndex = to;
        this.bridge.handlers.onReorder(from, to, expectedCount);
      },
      onDragStart: () => this.setDragging(true),
      onDragEnd: () => this.setDragging(false),
    };
    const focus = this.focusIndex;
    this.focusIndex = null;
    renderSidebar(this.contentEl, model, handlers, focus);
```

- [ ] **Step 6: Alles laufen lassen und committen**

Run: `npm run typecheck && npm test`
Expected: alle Suiten grün.

```bash
git add src/obsidian/sidebar-render.ts src/obsidian/hub-view.ts tests/obsidian/sidebar-render.test.ts
git commit -m "feat(sidebar): Kapitel per Alt+Pfeil umsortieren

Nutzt denselben onReorder-Weg wie das Ziehen. Nach dem Neuaufbau wird
die bewegte Zeile wieder fokussiert - sonst liefe der zweite Tastendruck
ins Leere, weil der Neuaufbau das DOM ersetzt hat."
```

---

### Task 6: M2 — Live-Refresh bei Embed-Edits in der Notiz

Schließt den offenen Plan-4-Carry-forward: Bislang aktualisiert sich das Panel nur bei Notiz-Wechseln, nicht wenn Embeds **in** der offenen Buch-Notiz getippt oder gelöscht werden.

**Files:**
- Modify: `src/obsidian/hub-view.ts:44-48`
- Test: `tests/obsidian/hub-view.test.ts`

**Interfaces:**
- Consumes: `resolveTargetFile` (bestehend), Gesten-Sperre aus Task 4.
- Produces: keine neue öffentliche Schnittstelle.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ergänze in `tests/obsidian/hub-view.test.ts` am Dateiende:

```ts
describe("EpubHubView · Live-Refresh (M2)", () => {
  function setup(targetPath: string) {
    const md = new MarkdownView();
    const f = new TFile();
    f.path = targetPath;
    md.file = f;

    const registered: Record<string, (arg: unknown) => void> = {};
    const app = {
      workspace: {
        rootSplit: {},
        getMostRecentLeaf: () => ({ view: md }),
        on: (ev: string, fn: (arg: unknown) => void) => { registered[`ws:${ev}`] = fn; return {}; },
      },
      metadataCache: {
        on: (ev: string, fn: (arg: unknown) => void) => { registered[`mc:${ev}`] = fn; return {}; },
      },
    };

    let renders = 0;
    const view = new EpubHubView(new WorkspaceLeaf() as never, {
      snapshot: async () => { renders++; return { kind: "note", title: "A", chapters: [] }; },
      handlers: {
        onExport: () => {}, onInsertFrontmatter: () => {}, onConsolidate: () => {}, onReorder: () => {},
      },
    });
    (view as unknown as { app: unknown }).app = app;
    return { view, registered, renders: () => renders };
  }

  it("re-reads when the note on screen changes on disk", async () => {
    const { view, registered, renders } = setup("Book.md");
    await view.onOpen();
    const before = renders();

    const changed = new TFile();
    changed.path = "Book.md";
    registered["mc:changed"](changed);
    await Promise.resolve();

    expect(renders()).toBeGreaterThan(before);
  });

  it("ignores changes to unrelated notes", async () => {
    const { view, registered, renders } = setup("Book.md");
    await view.onOpen();
    const before = renders();

    const other = new TFile();
    other.path = "Something else.md";
    registered["mc:changed"](other);
    await Promise.resolve();

    expect(renders()).toBe(before);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/hub-view.test.ts`
Expected: FAIL — `registered["mc:changed"] is not a function` (der Listener wird noch nicht registriert).

- [ ] **Step 3: Den Listener registrieren**

Ersetze in `src/obsidian/hub-view.ts` die Methode `onOpen` durch:

```ts
  async onOpen(): Promise<void> {
    await this.rerender();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.rerender()));
    this.registerEvent(this.app.workspace.on("file-open", () => void this.rerender()));
    // M2 (Plan-4 carry-forward): adding or removing an ![[embed]] *inside* the
    // open book note changes the spine without any leaf or file change, so the
    // list would otherwise stay stale until the user switched notes. This also
    // covers the echo of our own reorder write — showing the file's actual state
    // is exactly what we want, and the model-key memoisation keeps it free when
    // nothing really changed.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        if (file.path === resolveTargetFile(this.app)?.path) void this.rerender();
      })
    );
  }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/obsidian/hub-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Committen**

Run: `npm run typecheck && npm test`
Expected: alle Suiten grün.

```bash
git add src/obsidian/hub-view.ts tests/obsidian/hub-view.test.ts
git commit -m "feat(sidebar): Live-Refresh bei Embed-Edits (M2)

Schliesst den Plan-4-Carry-forward: Embeds, die direkt in der offenen
Buch-Notiz getippt oder geloescht werden, aktualisieren jetzt die
Kapitelliste. Deckt zugleich das Echo des eigenen Sortier-Schreibens ab."
```

---

### Task 7: Abschluss — Gate, Deploy, GUI-Smoke

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `../REGISTRY.md` (Dach-Registry)

**Interfaces:**
- Consumes: alles Vorherige.
- Produces: keine.

- [ ] **Step 1: Das vollständige Gate laufen lassen**

Run: `npm run gate`
Expected: `typecheck` + `test` + `check:pure` + `lint` + `build` alle grün. Bei Lint-Funden diese beheben, **ohne** Inline-`eslint-disable` (Store-Gate).

- [ ] **Step 2: CHANGELOG unter `[Unreleased]` ergänzen**

Trage unter `## [Unreleased]` ein (Abschnitt `### Added` anlegen, falls nicht vorhanden):

```markdown
### Added
- Kapitel lassen sich in der Sidebar per Ziehen oder `Alt+↑/↓` umsortieren; die neue Reihenfolge wird sofort in den Embed-Spine der Buch-Notiz geschrieben.
- Die Kapitelliste aktualisiert sich jetzt auch, wenn Embeds direkt in der offenen Buch-Notiz geändert werden.
```

- [ ] **Step 3: Ins Vault deployen**

**Gotcha (LESSONS.md 2026-07-23):** Der Plugin-Ordner im Vault ist eine **Kopie, kein Symlink** — ein Build allein erreicht das laufende Plugin nicht. Ein veralteter Build maskiert sich als Code-Bug.

```bash
npm run build
VAULT_PLUGIN="/Users/Shared/10_ObsidianVaults/10_Pallas/.obsidian/plugins/epub-exporter"
cp main.js styles.css "$VAULT_PLUGIN/"
grep -c "epub-sb-chapter-grip" "$VAULT_PLUGIN/main.js"
```

Expected: die Zählung ist `≥ 1` — der Beweis, dass der frische Build wirklich im Vault liegt. Danach Obsidian neu laden bzw. das Plugin aus- und einschalten.

- [ ] **Step 4: Committen**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): Kapitelsortierung und Live-Refresh unter [Unreleased]"
```

- [ ] **Step 5: GUI-Smoke an Jay übergeben**

Der **eine kritische Test** zuerst, der Rest ausdrücklich optional:

> **Kritisch:** Eine Buch-Notiz öffnen, in der Sidebar ein Kapitel an eine andere Position ziehen, dann die Buch-Notiz ansehen. Erwartung: **Nur die Reihenfolge der `![[…]]`-Zeilen hat sich geändert** — Prosa zwischen den Kapiteln, Überschriften und etwaige Aliase (`![[Kapitel|Anderer Titel]]`) stehen unverändert da.
>
> Optional, falls Lust: `Alt+↑/↓` auf einer angeklickten Kapitelzeile · ein Kapitel mit ⚠ (fehlende Datei) ziehen · in der offenen Notiz eine `![[…]]`-Zeile ergänzen und prüfen, ob die Liste sofort nachzieht.

- [ ] **Step 6: REGISTRY-Eintrag ergänzen**

Trage in `../REGISTRY.md` unter der passenden Rubrik ein:

```
[Markdown / Notes] Zeilenweises Umsortieren eines Embed-Spines ohne Rekonstruktion (Alias/Heading bleiben erhalten) → `epub-exporter/src/core/spine-reorder.ts` → `reorderSpine` (Kit-Kandidat)
```

```bash
git -C .. add REGISTRY.md
git -C .. commit -m "docs(registry): reorderSpine als Kit-Kandidat aufnehmen"
```

---

## Self-Review

**Spec-Abdeckung** — jede Spec-Anforderung hat eine Task:

| Spec | Task |
|---|---|
| §3 rohe Zeilen umsortieren, nie rekonstruieren | 1 |
| §4.1 `reorderSpine` samt `conflict`/`noop`/`out-of-range`, Zeilenenden | 1 |
| §4.1 gemeinsame Zeilenregel statt Duplikat | 1 (`matchEmbedLine`) |
| §4.2 `canReorder` | 3 |
| §4.3 Ziehgriff, `draggable`, `tabindex`, Drag-Ereignisse | 4 |
| §4.3 `Alt+↑/↓` | 5 |
| §4.4 Gesten-Sperre mit Nachholen | 4 |
| §4.4 M2-Listener | 6 |
| §4.4 Fokus nach Neuaufbau | 5 |
| §4.5 `vault.process`, Frontmatter-Schnitt | 2 + 4 |
| §6 Fehlerfälle (noop/Grenze/Konflikt/Schreibfehler) | 1 (rein) + 4 (Notices) |
| §8 Teststrategie | in jeder Task |
| §9 i18n, CSS, REGISTRY | 4 (i18n/CSS), 7 (REGISTRY) |

**Platzhalter:** keine — jeder Schritt enthält den vollständigen Code bzw. den exakten Befehl mit erwarteter Ausgabe.

**Typkonsistenz geprüft:** `reorderSpine(body, from, to, expectedCount)` wird in Task 4 Step 11 mit genau dieser Signatur gerufen · `onReorder(from, to, expectedCount)` ist in Renderer (Task 4/5), Ansicht (Task 4/5) und `main.ts` (Task 4) identisch · `splitFrontmatter` liefert `{ head, body }` und wird so destrukturiert · `SidebarModel.canReorder` wird in Task 3 eingeführt und ab Task 4 gelesen · `FakeEl.dispatch`/`focusCount`/`draggable` werden in Task 4 Step 1 definiert und ab Task 4 Step 3 benutzt.

**Bekannte Zwischenzustände:** Keine. Jede Task endet mit grünem `typecheck` + `test`; die Kopplung über `SidebarHandlers` ist bewusst in der vertikalen Scheibe (Task 4) gebündelt.
