# EPUB Exporter — Phase 1, Plan 2: Rendering & Book Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a real Obsidian note (single note OR book note with `![[embeds]]`) or a folder into an in-memory `Book`, and thereby into valid EPUB3 bytes — with the Plan-1 core-engine fixes the final review demanded — while keeping the assembly logic unit-testable via injected ports (no Obsidian runtime needed in tests).

**Architecture:** Two Plan-1 core modules get corrective enhancements (`dom-to-xhtml` context-sensitive degradation; `epub-builder` empty-book guard). New pure/injected-testable pieces: i18n + settings scaffold (vendored kit), a pure `ImageRegistry`, and the `book-assembler` orchestrator that takes an `AssemblerDeps` port bundle → `Book`. One thin Obsidian adapter (`render-adapter`) is smoke-verified, not unit-tested. The Obsidian-runtime shell (commands, settings UI, output destinations, `main.ts` wiring, GUI smoke) is **Plan 3**; the sidebar is **Plan 4**.

**Tech Stack:** TypeScript · esbuild · vitest · jsdom (test DOM) · vendored `obsidian-kit` (`i18n`, `settings`). No runtime dependencies.

## Global Constraints

Bind every task (verbatim from the spec / Plan-1 constraints):

- **No npm runtime dependencies.** `jsdom`/`fflate` stay dev-only. Production uses web standards + `obsidian`.
- **No `node:` import** anywhere in `src/`.
- **`src/core/` never imports `obsidian`** — it stays pure and node-testable. Obsidian coupling lives only in `src/obsidian/`. `src/vendor/kit/` is pure (vendored from `obsidian-kit/src/pure/`).
- **Vendored kit files carry the header** `// vendored from obsidian-kit, src/pure/<f>.ts — do not hand-edit; re-vendor via tools/sync-kit.sh` and are never hand-edited.
- **i18n:** UI language follows Obsidian (`getLanguage()` → `pickLang` → `setLang`), EN canonical, DE parallel; EN/DE key sets must be identical.
- **Testability via ports:** Obsidian access in the assembler is injected as an `AssemblerDeps` interface; tests pass fakes. The real adapter implementations that touch `app.*` are the only non-unit-tested code and are flagged for the Plan 3 GUI smoke test.
- EPUB output stays EPUB3 valid (Plan-1 invariants unchanged).

---

## File Structure

| Datei | Verantwortung | Status |
|---|---|---|
| `src/core/dom-to-xhtml.ts` | **modify** — context-sensitive degradation, unwrap div/section/article, callout/math handling, attribute whitelist | Task 1 |
| `tests/core/dom-to-xhtml.test.ts` | **modify** — update the one changed expectation + add degradation tests | Task 1 |
| `src/core/epub-builder.ts` | **modify** — empty-book guard | Task 2 |
| `tools/sync-kit.sh` | create — vendors kit `i18n.ts` + `settings.ts` | Task 3 |
| `src/vendor/kit/i18n.ts`, `src/vendor/kit/settings.ts` | create (via script) — vendored kit | Task 3 |
| `src/i18n/strings.ts` | create — EN/DE tables + `registerI18n()` | Task 3 |
| `tests/i18n/strings.test.ts` | create — EN/DE key parity | Task 3 |
| `src/obsidian/settings.ts` | create — settings model + defaults + `coerceSettings` | Task 4 |
| `tests/obsidian/settings.test.ts` | create — merge behavior | Task 4 |
| `src/obsidian/render-adapter.ts` | create — `MarkdownRenderer.render` wrapper (thin, smoke-verified) | Task 5 |
| `src/core/image-registry.ts` | create — pure image dedup/id/href/mediaType registry | Task 6 |
| `tests/core/image-registry.test.ts` | create | Task 6 |
| `src/obsidian/book-assembler.ts` | create — `AssemblerDeps` port + `assembleBook` orchestrator | Task 7 |
| `tests/obsidian/book-assembler.test.ts` | create — full assembly with fake deps | Task 7 |

**Note on `src/obsidian/book-assembler.ts` purity:** it imports only Plan-1 `src/core/*` modules and types — NOT `obsidian`. All Obsidian access arrives through the injected `AssemblerDeps`. It lives under `src/obsidian/` because it is the composition seam, but it is node-testable. (The concrete `AssemblerDeps` implementation that calls `app.*` is built in Plan 3.)

---

## Task 1: `dom-to-xhtml` — context-sensitive degradation (fixes the final-review bug)

**Files:**
- Modify: `src/core/dom-to-xhtml.ts`
- Modify: `tests/core/dom-to-xhtml.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: same `domToXhtml(root, ctx)` / `RenderContext` signature. Behavior change: unknown elements degrade to **inline-safe escaped text** (no `<p>` wrapper — fixes invalid `<p>`-in-`<p>` nesting); `div`/`section`/`article` are **unwrapped** (children serialized, no wrapper); `div.callout` and `mjx-container`/`.math` call `onUnsupported` and degrade; a small per-tag attribute whitelist is preserved.

**Why:** The Plan-1 final review (opus) flagged that the old unknown-element fallback `<p>${text}</p>` produces nested `<p>` when the unknown sits inside a paragraph — invalid XHTML that epubcheck rejects — and that `div`/`span` passthrough let callouts through raw while dropping all attributes. This task lands the deferred fix before the real `MarkdownRenderer` DOM ever flows through (Plan 3).

- [ ] **Step 1: Update the changed test + add the new degradation tests**

In `tests/core/dom-to-xhtml.test.ts`, **replace** the existing test `it("degrades an unsupported element to a text paragraph and reports it", ...)` with the block below, and **add** the four new tests after it (keep all other existing tests unchanged):

```ts
  it("degrades an unknown element to inline-safe text (no <p> wrapper) and reports it", () => {
    const onUnsupported = vi.fn();
    // unknown element sitting INSIDE a paragraph must NOT produce nested <p>
    const out = domToXhtml(frag("<p>a <foo>x</foo> b</p>"), ctx({ onUnsupported }));
    expect(out).toBe("<p>a x b</p>");
    expect(onUnsupported).toHaveBeenCalledWith("foo");
  });

  it("unwraps div/section/article without emitting the wrapper", () => {
    const out = domToXhtml(frag("<div><p>hi</p></div><section><p>yo</p></section>"), ctx());
    expect(out).toBe("<p>hi</p><p>yo</p>");
  });

  it("unwraps a callout div and reports it as unsupported", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(
      frag('<div class="callout"><div class="callout-title">Note</div><div class="callout-content"><p>body</p></div></div>'),
      ctx({ onUnsupported })
    );
    // callout box unwrapped: title text kept as unwrapped text, content <p> kept
    expect(out).toBe("Note<p>body</p>");
    expect(onUnsupported).toHaveBeenCalledWith("callout");
  });

  it("degrades a math container to text and reports it", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag("<mjx-container>x^2</mjx-container>"), ctx({ onUnsupported }));
    expect(out).toBe("x^2");
    expect(onUnsupported).toHaveBeenCalledWith("math");
  });

  it("keeps whitelisted attributes and drops the rest", () => {
    const out = domToXhtml(
      frag('<table><tbody><tr><td colspan="2" style="color:red" onclick="x()">c</td></tr></tbody></table>'),
      ctx()
    );
    expect(out).toBe('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>');
  });
```

- [ ] **Step 2: Run the test file, verify the new/changed tests fail**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: FAIL — the changed unknown-element test now expects `<p>a x b</p>` but the old code emits `<p>a <p>x</p> b</p>`; the unwrap/callout/math/attribute tests fail against the old passthrough logic.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire body of `src/core/dom-to-xhtml.ts` with:

```ts
export interface RenderContext {
  // EPUB href for an image src, or null to drop it (counts as unsupported).
  resolveImage(src: string): string | null;
  // Internal EPUB href (e.g. "chapter-03.xhtml") for a vault link target,
  // or null when the target is not part of this book (link -> plain text).
  resolveInternalLink(target: string): string | null;
  // Reports an element that was degraded (for the "N elements simplified" notice).
  onUnsupported(kind: string): void;
}

// Elements emitted verbatim (as valid XHTML tags).
const BLOCK = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "hr",
]);
const INLINE = new Set(["em", "strong", "del", "s", "b", "i", "code", "sup", "sub", "span", "br"]);
// Generic containers: unwrap (serialize children, drop the wrapper).
const UNWRAP = new Set(["div", "section", "article"]);
const VOID = new Set(["br", "hr"]);
// Per-tag attribute whitelist — everything else is dropped for safety/validity.
const ATTR_WHITELIST: Record<string, string[]> = {
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
};

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function serializeAttrs(el: Element, tag: string): string {
  const allow = ATTR_WHITELIST[tag];
  if (!allow) return "";
  let out = "";
  for (const name of allow) {
    const v = el.getAttribute(name);
    if (v !== null) out += ` ${name}="${escapeAttr(v)}"`;
  }
  return out;
}

export function domToXhtml(root: Node, ctx: RenderContext): string {
  return serializeChildren(root, ctx);
}

function serializeChildren(node: Node, ctx: RenderContext): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += serializeNode(child, ctx);
  });
  return out;
}

function serializeNode(node: Node, ctx: RenderContext): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? ""); // text
  if (node.nodeType !== 1) return ""; // comment/other
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "img") {
    const href = ctx.resolveImage(el.getAttribute("src") ?? "");
    if (href === null) {
      ctx.onUnsupported("image");
      return "";
    }
    const alt = el.getAttribute("alt") ?? "";
    return `<img src="${escapeAttr(href)}" alt="${escapeAttr(alt)}"/>`;
  }

  if (tag === "a") {
    const inner = serializeChildren(el, ctx);
    const target = el.getAttribute("data-href") ?? el.getAttribute("href") ?? "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith("mailto:")) {
      return `<a href="${escapeAttr(target)}">${inner}</a>`;
    }
    const internal = ctx.resolveInternalLink(target);
    return internal ? `<a href="${escapeAttr(internal)}">${inner}</a>` : inner;
  }

  // Math (MathJax container or an element flagged with the math class) -> text.
  if (tag === "mjx-container" || el.classList.contains("math")) {
    ctx.onUnsupported("math");
    return escapeText(el.textContent ?? "");
  }

  // Generic containers -> unwrap. A callout is a div; flag it, then keep its inner content.
  if (UNWRAP.has(tag)) {
    if (el.classList.contains("callout")) ctx.onUnsupported("callout");
    return serializeChildren(el, ctx);
  }

  if (BLOCK.has(tag) || INLINE.has(tag)) {
    if (VOID.has(tag)) return `<${tag}/>`;
    return `<${tag}${serializeAttrs(el, tag)}>${serializeChildren(el, ctx)}</${tag}>`;
  }

  // Unknown element -> inline-safe escaped text (NO <p> wrapper -> no invalid nesting).
  ctx.onUnsupported(tag);
  return escapeText(el.textContent ?? "");
}
```

- [ ] **Step 4: Run the test file, verify pass**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Run the full suite (nothing else regressed)**

Run: `npm test`
Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/dom-to-xhtml.ts tests/core/dom-to-xhtml.test.ts
git commit -m "fix(core): context-sensitive XHTML degradation (no nested <p>, unwrap divs, callout/math, attr whitelist)"
```

---

## Task 2: `epub-builder` — empty-book guard

**Files:**
- Modify: `src/core/epub-builder.ts`
- Modify: `tests/core/epub-builder.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `buildEpub` throws `Error("Cannot build an EPUB with no chapters.")` when `book.chapters.length === 0`; otherwise unchanged.

- [ ] **Step 1: Add the failing test**

Add to `tests/core/epub-builder.test.ts` inside the `describe("buildEpub", ...)` block:

```ts
  it("throws when the book has no chapters", () => {
    const book = fixtureBook();
    book.chapters = [];
    expect(() => buildEpub(book)).toThrow(/no chapters/i);
  });
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/core/epub-builder.test.ts`
Expected: FAIL — no error is thrown; an empty (invalid) EPUB is produced.

- [ ] **Step 3: Add the guard**

In `src/core/epub-builder.ts`, at the very top of `buildEpub`, before `const entries: ZipEntry[] = [];`:

```ts
export function buildEpub(book: Book): Uint8Array {
  if (book.chapters.length === 0) {
    throw new Error("Cannot build an EPUB with no chapters.");
  }
  const entries: ZipEntry[] = [];
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/core/epub-builder.test.ts`
Expected: PASS (all, including the new guard test).

- [ ] **Step 5: Commit**

```bash
git add src/core/epub-builder.ts tests/core/epub-builder.test.ts
git commit -m "fix(core): guard buildEpub against an empty (invalid) book"
```

---

## Task 3: i18n scaffold (vendored kit + strings + parity test)

**Files:**
- Create: `tools/sync-kit.sh`
- Create (via script): `src/vendor/kit/i18n.ts`, `src/vendor/kit/settings.ts`
- Create: `src/i18n/strings.ts`
- Create: `tests/i18n/strings.test.ts`

**Interfaces:**
- Consumes: vendored `defineStrings`, `t`, `pickLang`, `setLang`, `getLang`, type `Lang` from `../vendor/kit/i18n`; `mergeSettings` from `../vendor/kit/settings` (used in Task 4)
- Produces: `EN`, `DE` (both `Record<string, string>`, identical key sets), `registerI18n(): void`

- [ ] **Step 1: Write `tools/sync-kit.sh`**

```sh
#!/bin/sh
# Vendors pure modules from the sibling obsidian-kit repo. Do not hand-edit the
# generated files under src/vendor/kit — re-run this script to update them.
set -e
KIT=../obsidian-kit/src/pure
mkdir -p src/vendor/kit
for f in i18n settings; do
  header="// vendored from obsidian-kit, src/pure/$f.ts — do not hand-edit; re-vendor via tools/sync-kit.sh"
  { printf '%s\n' "$header"; cat "$KIT/$f.ts"; } > "src/vendor/kit/$f.ts"
done
echo "vendored: i18n, settings"
```

- [ ] **Step 2: Run the vendor script**

Run: `sh tools/sync-kit.sh && head -1 src/vendor/kit/i18n.ts && head -1 src/vendor/kit/settings.ts`
Expected: both files created, each first line is the `// vendored from obsidian-kit …` header. (The sibling `../obsidian-kit` repo must be present — it is, in the same `obsidian-plugins/` parent.)

- [ ] **Step 3: Write the strings table + `registerI18n`**

`src/i18n/strings.ts`:

```ts
import { defineStrings } from "../vendor/kit/i18n";

export const EN: Record<string, string> = {
  "cmd.exportBook": "Export book as EPUB",
  "cmd.exportNote": "Export note as EPUB",
  "cmd.exportFolder": "Export folder as EPUB",
  "cmd.insertFrontmatter": "Insert book frontmatter into note",
  "cmd.exportRibbon": "Export as EPUB",
  "notice.noActiveNote": "Open a Markdown note first.",
  "notice.noChapters": "Nothing to export — this book has no chapters.",
  "notice.saved": "EPUB saved to {0}.",
  "notice.shared": "EPUB ready to share.",
  "notice.simplified": "EPUB created. {0} element(s) were simplified (e.g. callouts, math).",
  "notice.brokenEmbed": "{0} embedded chapter(s) could not be found and were skipped.",
  "notice.fmAdded": "Book frontmatter added.",
  "notice.fmFailed": "Could not add book frontmatter.",
  "notice.exportFailed": "EPUB export failed — see console for details.",
};

export const DE: Record<string, string> = {
  "cmd.exportBook": "Buch als EPUB exportieren",
  "cmd.exportNote": "Notiz als EPUB exportieren",
  "cmd.exportFolder": "Ordner als EPUB exportieren",
  "cmd.insertFrontmatter": "Buch-Frontmatter in Notiz einfügen",
  "cmd.exportRibbon": "Als EPUB exportieren",
  "notice.noActiveNote": "Öffne zuerst eine Markdown-Notiz.",
  "notice.noChapters": "Nichts zu exportieren — dieses Buch hat keine Kapitel.",
  "notice.saved": "EPUB gespeichert unter {0}.",
  "notice.shared": "EPUB bereit zum Teilen.",
  "notice.simplified": "EPUB erstellt. {0} Element(e) wurden vereinfacht (z.B. Callouts, Mathe).",
  "notice.brokenEmbed": "{0} eingebettete(s) Kapitel nicht gefunden und übersprungen.",
  "notice.fmAdded": "Buch-Frontmatter ergänzt.",
  "notice.fmFailed": "Buch-Frontmatter konnte nicht ergänzt werden.",
  "notice.exportFailed": "EPUB-Export fehlgeschlagen — Details in der Konsole.",
};

export function registerI18n(): void {
  defineStrings({ en: EN, de: DE });
}
```

- [ ] **Step 4: Write the parity test**

`tests/i18n/strings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EN, DE } from "../../src/i18n/strings";

describe("i18n strings", () => {
  it("EN and DE have identical key sets", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it("no value is an empty string", () => {
    for (const [k, v] of Object.entries(EN)) expect(v, `EN ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(DE)) expect(v, `DE ${k}`).not.toBe("");
  });
});
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run tests/i18n/strings.test.ts && npm run typecheck`
Expected: PASS (2 tests), no type errors (confirms the vendored `i18n.ts` types resolve).

- [ ] **Step 6: Commit**

```bash
git add tools/sync-kit.sh src/vendor/kit/i18n.ts src/vendor/kit/settings.ts src/i18n/strings.ts tests/i18n/strings.test.ts
git commit -m "feat(i18n): vendor kit i18n+settings, EN/DE strings with parity test"
```

---

## Task 4: settings model

**Files:**
- Create: `src/obsidian/settings.ts`
- Create: `tests/obsidian/settings.test.ts`

**Interfaces:**
- Consumes: `mergeSettings` from `../vendor/kit/settings`
- Produces:
  - `type OutputDestination = "besideNote" | "attachmentFolder" | "customFolder" | "share"`
  - `interface EpubExporterSettings { outputDestination; customFolder; openSidebarOnStartup; defaultLanguage }`
  - `const DEFAULT_SETTINGS: EpubExporterSettings`
  - `coerceSettings(raw: unknown): EpubExporterSettings`

**Note:** This file defines only the model + merge (pure, testable). The `SettingTab` UI class and `loadData`/`saveData` wiring are Plan 3. `src/obsidian/settings.ts` imports only the vendored (pure) `settings` helper, not `obsidian`, so it is node-testable.

- [ ] **Step 1: Write the failing test**

`tests/obsidian/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS } from "../../src/obsidian/settings";

describe("coerceSettings", () => {
  it("returns defaults for null/undefined/non-object", () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("overlays stored values onto defaults", () => {
    const s = coerceSettings({ outputDestination: "share", customFolder: "Books" });
    expect(s.outputDestination).toBe("share");
    expect(s.customFolder).toBe("Books");
    expect(s.openSidebarOnStartup).toBe(false); // default preserved
  });

  it("does not mutate DEFAULT_SETTINGS", () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    coerceSettings({ customFolder: "X" });
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/obsidian/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/obsidian/settings.ts`:

```ts
import { mergeSettings } from "../vendor/kit/settings";

export type OutputDestination =
  | "besideNote"
  | "attachmentFolder"
  | "customFolder"
  | "share";

export interface EpubExporterSettings {
  outputDestination: OutputDestination;
  customFolder: string;
  openSidebarOnStartup: boolean;
  defaultLanguage: string;
}

export const DEFAULT_SETTINGS: EpubExporterSettings = {
  outputDestination: "besideNote",
  customFolder: "",
  openSidebarOnStartup: false,
  defaultLanguage: "en",
};

// Merge persisted data (from Plugin.loadData()) onto the defaults without
// mutating DEFAULT_SETTINGS (one-level-deep clone via the kit helper).
export function coerceSettings(raw: unknown): EpubExporterSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/obsidian/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/settings.ts tests/obsidian/settings.test.ts
git commit -m "feat(settings): settings model + defaults + non-mutating merge"
```

---

## Task 5: `render-adapter` — MarkdownRenderer wrapper (thin, smoke-verified)

**Files:**
- Create: `src/obsidian/render-adapter.ts`

**Interfaces:**
- Consumes: `App`, `Component`, `MarkdownRenderer` from `obsidian`
- Produces: `renderMarkdownToDom(app: App, markdown: string, sourcePath: string): Promise<RenderedMarkdown>` where `interface RenderedMarkdown { root: HTMLElement; dispose: () => void }`

**Testing note (no unit test — justified):** this is a thin, irreducible Obsidian-runtime adapter (it calls the Obsidian static `MarkdownRenderer.render` and the `createDiv()` global). There is no behavior to unit-test without the Obsidian runtime; the kit's `obsidian-mock` does not implement `MarkdownRenderer`. It is verified by `npm run typecheck` here and exercised end-to-end in the Plan 3 GUI smoke test. Do **not** fabricate a mock-only test that asserts nothing.

- [ ] **Step 1: Implement**

`src/obsidian/render-adapter.ts`:

```ts
import { App, Component, MarkdownRenderer } from "obsidian";

export interface RenderedMarkdown {
  root: HTMLElement;
  dispose: () => void;
}

// Render a note's markdown body to a detached DOM subtree. The caller MUST call
// dispose() when done (unloads the render Component and its post-processors).
// Pattern mirrors obsidian-paperize / obsidian-letterhead: a detached createDiv()
// as the container, a throwaway Component as lifecycle owner, awaited render.
export async function renderMarkdownToDom(
  app: App,
  markdown: string,
  sourcePath: string
): Promise<RenderedMarkdown> {
  const root = createDiv();
  const comp = new Component();
  await MarkdownRenderer.render(app, markdown, root, sourcePath, comp);
  return { root, dispose: () => comp.unload() };
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no type errors; `main.js` builds. (Confirms the `obsidian` API signatures resolve against the installed types.)

- [ ] **Step 3: Commit**

```bash
git add src/obsidian/render-adapter.ts
git commit -m "feat(obsidian): render-adapter wrapping MarkdownRenderer.render"
```

---

## Task 6: `image-registry` — pure image dedup/id/href/mediaType

**Files:**
- Create: `src/core/image-registry.ts`
- Create: `tests/core/image-registry.test.ts`

**Interfaces:**
- Consumes: `ImageAsset` from `./model`
- Produces:
  - `mediaTypeForPath(path: string): string | null`
  - `interface ImageSource { data: Uint8Array; path: string }`
  - `class ImageRegistry` with:
    - `constructor(read: (src: string) => Promise<ImageSource | null>)`
    - `resolve(src: string): Promise<{ id: string; href: string } | null>` — dedups by `src`, assigns `img-NN` id + `images/img-NN.<ext>` href, records the `ImageAsset`; returns `null` if `read` returns null or the extension has no known media type
    - `images(): ImageAsset[]`

**Why pure + injected:** mapping a rendered `<img src>` back to vault bytes is Obsidian-specific and lives in the Plan-3 adapter; the id/dedup/href/mediaType logic is pure and belongs here where it is node-testable with a fake `read`.

- [ ] **Step 1: Write the failing test**

`tests/core/image-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ImageRegistry, mediaTypeForPath, ImageSource } from "../../src/core/image-registry";

const bytes = (n: number) => new Uint8Array([n, n, n]);

function fakeRead(map: Record<string, { path: string; n: number }>) {
  return async (src: string): Promise<ImageSource | null> => {
    const hit = map[src];
    return hit ? { data: bytes(hit.n), path: hit.path } : null;
  };
}

describe("mediaTypeForPath", () => {
  it("maps known extensions and rejects unknown", () => {
    expect(mediaTypeForPath("a/b.png")).toBe("image/png");
    expect(mediaTypeForPath("c.JPG")).toBe("image/jpeg");
    expect(mediaTypeForPath("d.svg")).toBe("image/svg+xml");
    expect(mediaTypeForPath("e.txt")).toBeNull();
  });
});

describe("ImageRegistry", () => {
  it("assigns sequential ids and hrefs and records assets", async () => {
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 }, "b.jpg": { path: "img/b.jpg", n: 2 } }));
    expect(await reg.resolve("a.png")).toEqual({ id: "img-01", href: "images/img-01.png" });
    expect(await reg.resolve("b.jpg")).toEqual({ id: "img-02", href: "images/img-02.jpg" });
    const imgs = reg.images();
    expect(imgs.map((i) => i.id)).toEqual(["img-01", "img-02"]);
    expect(imgs[0].mediaType).toBe("image/png");
    expect(Array.from(imgs[1].data)).toEqual([2, 2, 2]);
  });

  it("dedups a repeated src to the same href without adding a second asset", async () => {
    const reg = new ImageRegistry(fakeRead({ "a.png": { path: "img/a.png", n: 1 } }));
    const first = await reg.resolve("a.png");
    const second = await reg.resolve("a.png");
    expect(second).toEqual(first);
    expect(reg.images()).toHaveLength(1);
  });

  it("returns null (and records nothing) when read fails or type is unknown", async () => {
    const reg = new ImageRegistry(fakeRead({ "x.txt": { path: "x.txt", n: 9 } }));
    expect(await reg.resolve("missing.png")).toBeNull();
    expect(await reg.resolve("x.txt")).toBeNull();
    expect(reg.images()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/core/image-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/image-registry.ts`:

```ts
import { ImageAsset } from "./model";

const EXT_MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function mediaTypeForPath(path: string): string | null {
  return EXT_MEDIA[extOf(path)] ?? null;
}

export interface ImageSource {
  data: Uint8Array;
  path: string; // vault path (for extension/media-type)
}

export class ImageRegistry {
  private assets: ImageAsset[] = [];
  private bySrc = new Map<string, { id: string; href: string }>();
  private counter = 0;

  constructor(private read: (src: string) => Promise<ImageSource | null>) {}

  async resolve(src: string): Promise<{ id: string; href: string } | null> {
    const seen = this.bySrc.get(src);
    if (seen) return seen;
    const got = await this.read(src);
    if (!got) return null;
    const mediaType = mediaTypeForPath(got.path);
    if (!mediaType) return null;
    this.counter++;
    const id = `img-${String(this.counter).padStart(2, "0")}`;
    const href = `images/${id}.${extOf(got.path)}`;
    this.assets.push({ id, href, mediaType, data: got.data });
    const ref = { id, href };
    this.bySrc.set(src, ref);
    return ref;
  }

  images(): ImageAsset[] {
    return this.assets;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/core/image-registry.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/image-registry.ts tests/core/image-registry.test.ts
git commit -m "feat(core): pure image registry (dedup, id/href, media type)"
```

---

## Task 7: `book-assembler` — source → `Book` (the integration heart)

**Files:**
- Create: `src/obsidian/book-assembler.ts`
- Create: `tests/obsidian/book-assembler.test.ts`

**Interfaces:**
- Consumes: `Book`, `Chapter` (`./../core/model`), `parseBookMetadata`, `isBookNote` (`../core/frontmatter`), `parseEmbedSpine`, `sortFolderChapters` (`../core/spine-parser`), `domToXhtml`, `RenderContext` (`../core/dom-to-xhtml`), `ImageRegistry`, `ImageSource` (`../core/image-registry`)
- Produces:
  - `interface NoteData { path: string; basename: string; frontmatter: Record<string, unknown>; body: string }`
  - `interface AssemblerDeps` (the injected Obsidian port bundle — see code)
  - `type BookSource = { kind: "note"; path: string } | { kind: "folder"; path: string }`
  - `interface AssembledBook { book: Book; simplifiedCount: number; missing: string[] }`
  - `assembleBook(deps: AssemblerDeps, source: BookSource, opts: { defaultLanguage: string; rng?: () => number }): Promise<AssembledBook>`

**Behavior:**
- `source.kind === "note"`: read the note. If `isBookNote(fm)`: chapters = top-level `![[embeds]]` (via `parseEmbedSpine`, each resolved to a note path); if the book-note body has non-embed prose, it becomes a **leading chapter** titled from the note. Metadata from the book note's frontmatter. Else (plain note): one chapter = the note itself; metadata from its frontmatter with `fallbackTitle = basename`.
- `source.kind === "folder"`: list markdown notes in the folder, `sortFolderChapters` by filename; each is a chapter; metadata default with `fallbackTitle` = folder name.
- Cross-chapter links: build a `linkMap` from every chapter note's path/basename → its `chapter-NN.xhtml` filename; `RenderContext.resolveInternalLink` looks up by normalized basename.
- Images: one `ImageRegistry` per book; per chapter, pre-scan `<img>` elements and resolve bytes, so `resolveImage` is a sync map lookup.
- Cover: if frontmatter `cover` is set (a `[[wikilink]]` or path), resolve its bytes via the registry and set `book.coverImageId`.
- `simplifiedCount` aggregates all `onUnsupported` calls + images that failed to resolve. `missing` collects embed targets that could not be read (for later sidebar warnings).

- [ ] **Step 1: Write the failing test**

`tests/obsidian/book-assembler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleBook, AssemblerDeps, NoteData } from "../../src/obsidian/book-assembler";

// A fake vault: notes keyed by path, images keyed by src, plus a rendered-DOM
// stand-in. renderMarkdown returns a jsdom-free fake root whose querySelectorAll
// and childNodes drive domToXhtml — but to keep the test pure we render a tiny
// DOM using the linkedom-free approach: we feed pre-built HTML through a minimal
// DOM. vitest's jsdom env gives us document.
// @vitest-environment jsdom

function makeDeps(notes: Record<string, NoteData>, images: Record<string, { path: string; n: number }>): AssemblerDeps {
  return {
    async renderMarkdown(markdown, _sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown; // test notes provide HTML bodies directly
      return { root, dispose: () => {} };
    },
    async readNote(path) {
      return notes[path] ?? null;
    },
    resolveNotePath(target, _sourcePath) {
      // test targets are exact note paths (with or without .md)
      const withMd = target.endsWith(".md") ? target : target + ".md";
      if (notes[withMd]) return withMd;
      if (notes[target]) return target;
      return null;
    },
    async readImage(target, _sourcePath) {
      const hit = images[target];
      return hit ? { data: new Uint8Array([hit.n, hit.n]), path: hit.path } : null;
    },
    async listFolderNotes(folderPath) {
      return Object.keys(notes).filter((p) => p.startsWith(folderPath + "/") && !p.slice(folderPath.length + 1).includes("/"));
    },
  };
}

const note = (path: string, body: string, frontmatter: Record<string, unknown> = {}): NoteData => ({
  path,
  basename: path.replace(/\.md$/, "").split("/").pop()!,
  frontmatter,
  body,
});

const opts = { defaultLanguage: "en", rng: () => 0.5 };

describe("assembleBook — book note with embeds", () => {
  it("builds chapters from top-level embeds in order with book metadata", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "My Book", author: "Jay", language: "de" }),
      "Intro.md": note("Intro.md", "<p>intro text</p>"),
      "Body.md": note("Body.md", "<p>body text</p>"),
    };
    const { book, missing } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.metadata.title).toBe("My Book");
    expect(book.metadata.language).toBe("de");
    expect(book.chapters.map((c) => c.title)).toEqual(["Intro", "Body"]);
    expect(book.chapters[0].xhtml).toContain("intro text");
    expect(missing).toEqual([]);
  });

  it("records a missing embed target instead of throwing", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Gone]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", "<p>x</p>"),
    };
    const { book, missing } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["Intro"]);
    expect(missing).toEqual(["Gone"]);
  });

  it("rewrites a cross-chapter link to the target chapter file", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]\n![[Body]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", '<p>see <a data-href="Body" href="Body" class="internal-link">Body</a></p>'),
      "Body.md": note("Body.md", "<p>body</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Book.md" }, opts);
    expect(book.chapters[0].xhtml).toContain('href="chapter-02.xhtml"');
  });

  it("embeds a chapter image and reports none simplified for a supported image", async () => {
    const notes = {
      "Book.md": note("Book.md", "![[Intro]]", { epub: true, title: "B" }),
      "Intro.md": note("Intro.md", '<p><img src="pic.png" alt=""></p>'),
    };
    const { book, simplifiedCount } = await assembleBook(makeDeps(notes, { "pic.png": { path: "pic.png", n: 7 } }), { kind: "note", path: "Book.md" }, opts);
    expect(book.images).toHaveLength(1);
    expect(book.chapters[0].xhtml).toContain("images/img-01.png");
    expect(simplifiedCount).toBe(0);
  });
});

describe("assembleBook — single note", () => {
  it("produces one chapter with basename fallback title", async () => {
    const notes = { "Solo.md": note("Solo.md", "<p>hello</p>") };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "note", path: "Solo.md" }, opts);
    expect(book.chapters).toHaveLength(1);
    expect(book.metadata.title).toBe("Solo");
    expect(book.chapters[0].xhtml).toContain("hello");
  });
});

describe("assembleBook — folder", () => {
  it("orders chapters by filename and titles the book from the folder", async () => {
    const notes = {
      "Bk/02 Two.md": note("Bk/02 Two.md", "<p>two</p>"),
      "Bk/01 One.md": note("Bk/01 One.md", "<p>one</p>"),
      "Bk/10 Ten.md": note("Bk/10 Ten.md", "<p>ten</p>"),
    };
    const { book } = await assembleBook(makeDeps(notes, {}), { kind: "folder", path: "Bk" }, opts);
    expect(book.chapters.map((c) => c.title)).toEqual(["01 One", "02 Two", "10 Ten"]);
    expect(book.metadata.title).toBe("Bk");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/obsidian/book-assembler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/obsidian/book-assembler.ts`:

```ts
import { Book, Chapter } from "../core/model";
import { parseBookMetadata, isBookNote } from "../core/frontmatter";
import { parseEmbedSpine } from "../core/spine-parser";
import { sortFolderChapters } from "../core/spine-parser";
import { domToXhtml, RenderContext } from "../core/dom-to-xhtml";
import { ImageRegistry, ImageSource } from "../core/image-registry";
import { DEFAULT_BOOK_CSS } from "../core/epub-builder";

export interface NoteData {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  body: string; // markdown, frontmatter already stripped
}

export interface RenderedNote {
  root: HTMLElement;
  dispose: () => void;
}

// Injected Obsidian port bundle — real impl (app.*) is built in Plan 3.
export interface AssemblerDeps {
  renderMarkdown(markdown: string, sourcePath: string): Promise<RenderedNote>;
  readNote(path: string): Promise<NoteData | null>;
  resolveNotePath(target: string, sourcePath: string): string | null;
  readImage(target: string, sourcePath: string): Promise<ImageSource | null>;
  listFolderNotes(folderPath: string): Promise<string[]>;
}

export type BookSource =
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string };

export interface AssembledBook {
  book: Book;
  simplifiedCount: number;
  missing: string[];
}

interface ChapterPlan {
  title: string;
  body: string; // markdown to render
  sourcePath: string;
}

function basenameNoExt(path: string): string {
  return path.replace(/\.md$/i, "").split("/").pop() ?? path;
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
}

function linkKeysFor(path: string): string[] {
  const noExt = path.replace(/\.md$/i, "");
  return [noExt.toLowerCase(), basenameNoExt(path).toLowerCase()];
}

function normalizeLinkTarget(target: string): string {
  const t = target.split("|")[0].split("#")[0].replace(/\.md$/i, "").trim();
  return (t.split("/").pop() ?? t).toLowerCase();
}

function chapterTitle(note: NoteData): string {
  const ct = note.frontmatter["chapter_title"];
  if (typeof ct === "string" && ct) return ct;
  return note.basename;
}

// Strip a [[wikilink]] or ![[embed]] wrapper down to the inner target.
function unwrapLink(value: string): string {
  const m = value.match(/!?\[\[([^\]]+)\]\]/);
  const inner = m ? m[1] : value;
  return inner.split("|")[0].split("#")[0].trim();
}

export async function assembleBook(
  deps: AssemblerDeps,
  source: BookSource,
  opts: { defaultLanguage: string; rng?: () => number }
): Promise<AssembledBook> {
  const missing: string[] = [];
  let frontmatter: Record<string, unknown> = {};
  let fallbackTitle = "Untitled";
  const plans: ChapterPlan[] = [];

  if (source.kind === "folder") {
    fallbackTitle = source.path.split("/").pop() || source.path;
    const files = sortFolderChapters(await deps.listFolderNotes(source.path));
    for (const path of files) {
      const note = await deps.readNote(path);
      if (!note) {
        missing.push(path);
        continue;
      }
      if (note.frontmatter["epub_exclude"] === true) continue;
      plans.push({ title: chapterTitle(note), body: note.body, sourcePath: note.path });
    }
  } else {
    const root = await deps.readNote(source.path);
    if (!root) {
      throw new Error(`Cannot read note: ${source.path}`);
    }
    if (isBookNote(root.frontmatter)) {
      frontmatter = root.frontmatter;
      fallbackTitle = root.basename;
      const spine = parseEmbedSpine(root.body);
      // leading prose = book-note body with the embed lines removed
      const prose = root.body
        .split(/\r?\n/)
        .filter((line) => !/^!\[\[[^\]]+\]\]$/.test(line.trim()))
        .join("\n")
        .trim();
      if (prose) {
        plans.push({ title: root.basename, body: prose, sourcePath: root.path });
      }
      for (const entry of spine) {
        const path = deps.resolveNotePath(entry.target, root.path);
        const note = path ? await deps.readNote(path) : null;
        if (!note) {
          missing.push(entry.target);
          continue;
        }
        if (note.frontmatter["epub_exclude"] === true) continue;
        plans.push({ title: chapterTitle(note), body: note.body, sourcePath: note.path });
      }
    } else {
      // single note
      frontmatter = root.frontmatter;
      fallbackTitle = root.basename;
      plans.push({ title: chapterTitle(root), body: root.body, sourcePath: root.path });
    }
  }

  // Build the cross-chapter link map (path/basename -> chapter file).
  const linkMap = new Map<string, string>();
  plans.forEach((plan, i) => {
    for (const key of linkKeysFor(plan.sourcePath)) linkMap.set(key, chapterFileName(i));
  });

  const registry = new ImageRegistry((src) =>
    deps.readImage(src, plans[0]?.sourcePath ?? source.path)
  );
  let simplifiedCount = 0;
  const chapters: Chapter[] = [];

  for (const plan of plans) {
    const rendered = await deps.renderMarkdown(plan.body, plan.sourcePath);
    try {
      // Pre-resolve images so resolveImage can be synchronous.
      const srcToHref = new Map<string, string | null>();
      const imgs = rendered.root.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        const src = imgs[i].getAttribute("src") ?? "";
        if (srcToHref.has(src)) continue;
        const resolved = await registry.resolve(src);
        srcToHref.set(src, resolved ? resolved.href : null);
      }
      const ctx: RenderContext = {
        resolveImage: (src) => srcToHref.get(src) ?? null,
        resolveInternalLink: (target) => linkMap.get(normalizeLinkTarget(target)) ?? null,
        onUnsupported: () => {
          simplifiedCount++;
        },
      };
      chapters.push({ title: plan.title, xhtml: domToXhtml(rendered.root, ctx), sourcePath: plan.sourcePath });
    } finally {
      rendered.dispose();
    }
  }

  const metadata = parseBookMetadata(frontmatter, {
    fallbackTitle,
    defaultLanguage: opts.defaultLanguage,
    rng: opts.rng,
  });

  // Cover: resolve the frontmatter cover image (if any) through the registry.
  let coverImageId: string | undefined;
  if (metadata.coverImagePath) {
    const coverSrc = unwrapLink(metadata.coverImagePath);
    const resolved = await registry.resolve(coverSrc);
    if (resolved) coverImageId = resolved.id;
  }

  const book: Book = {
    metadata,
    chapters,
    images: registry.images(),
    coverImageId,
    css: DEFAULT_BOOK_CSS,
  };

  return { book, simplifiedCount, missing };
}
```

- [ ] **Step 4: Run the test file, verify pass**

Run: `npx vitest run tests/obsidian/book-assembler.test.ts`
Expected: PASS (all describe blocks: book-note-with-embeds, single-note, folder).

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests green, no type errors, `main.js` builds.

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/book-assembler.ts tests/obsidian/book-assembler.test.ts
git commit -m "feat(obsidian): book-assembler (note/book-note/folder -> Book) via injected ports"
```

---

## Self-Review (durch den Planautor durchgeführt)

**1. Spec/carry-forward coverage:**
- Final-review Important #1 (inline-unknown `<p>` nesting) → Task 1 (unknown → inline text) ✅
- Carry-forward: div/callout raw passthrough → Task 1 (unwrap + `onUnsupported("callout")`) ✅; math → Task 1 ✅; attribute loss → Task 1 whitelist ✅; empty-book guard → Task 2 ✅
- Spec: i18n (Kit `pure/i18n`) → Task 3 ✅; settings model + `mergeSettings` → Task 4 ✅; `MarkdownRenderer` render path → Task 5 ✅; image embedding (bytes as-is, media type) → Task 6 ✅; single-note / book-note-embeds / folder assembly + leading prose chapter + cross-chapter internal links + cover + graceful-degradation count → Task 7 ✅
- **Deferred to Plan 3 (correct):** SettingTab UI, `loadData`/`saveData`, output destinations (`writeEpub`), `insert-book-frontmatter` command, `main.ts` wiring, folder-context-menu entry, the concrete `AssemblerDeps` impl (`app.vault`/`metadataCache`/`fileManager`), GUI smoke `/user-handover`. **Plan 4:** sidebar.

**2. Placeholder scan:** every code step contains complete code; no TBD/TODO. Task 5 has no unit test — explicitly justified (irreducible Obsidian adapter, typecheck + Plan-3 smoke). ✅

**3. Type consistency:** `RenderContext`/`domToXhtml` (Task 1) consumed by Task 7 identically; `ImageAsset`/`Book`/`Chapter` (Plan-1 model) consumed by Tasks 6/7; `ImageRegistry`/`ImageSource` (Task 6) consumed by Task 7; `mergeSettings` (Task 3 vendor) consumed by Task 4; `coerceSettings`/`EpubExporterSettings` (Task 4) will be consumed by Plan 3. `AssemblerDeps` port fully defined in Task 7; its real impl is Plan 3. ✅

**4. Ambiguity check:** cross-chapter link resolution is basename-based (`normalizeLinkTarget` → last path segment, lowercased) — documented limitation: two chapters sharing a basename across folders could collide; acceptable for v1, revisit if reported. Leading-prose-chapter rule is explicit (book-note body minus whole-line embeds). `epub_exclude: true` honored in both folder and embed modes. ✅

**5. Testability note:** the assembler test uses `// @vitest-environment jsdom` and feeds HTML bodies directly as the "rendered" DOM (bypassing the real `MarkdownRenderer`), which is the correct seam — it tests assembly logic, not Obsidian's renderer. The real renderer is exercised in the Plan-3 GUI smoke test.
