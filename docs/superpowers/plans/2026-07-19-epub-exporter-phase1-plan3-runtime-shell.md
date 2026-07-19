# EPUB Exporter — Phase 1 · Plan 3 (Obsidian Runtime Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the finished pure engine + injected `assembleBook` port into a working Obsidian plugin — commands, ribbon, folder context-menu, insert-frontmatter, a concrete `AssemblerDeps` implementation, four output targets, and a settings tab — while closing the five Plan-2 carry-forward findings.

**Architecture:** Everything shippable already exists as pure, node-tested core (`src/core/*`) and an injected assembler (`src/obsidian/book-assembler.ts`, obsidian-namespaced but dependency-injected). Plan 3 adds (a) small pure closures for the remaining carry-forwards (code-block hijack guard, image dedup on resolved path, wider `dom-to-xhtml` unwrap, an end-to-end test), and (b) the thin Obsidian edge that wires `app.*` into the assembler port and writes the resulting bytes. The edge files import `obsidian` and are therefore **not** node-testable in this repo (no obsidian mock is configured); they are verified by `typecheck` + `build` green and a final GUI smoke handover.

**Tech Stack:** TypeScript · esbuild · vitest (node + per-file `@vitest-environment jsdom`) · vendored `obsidian-kit` (i18n/settings) · dependency-free runtime (own store-only ZIP writer). `fflate` is a **dev-only** dependency (unzip in the E2E test) and must never be imported from `src/`.

## Global Constraints

- **`minAppVersion: 1.8.7`**, **`isDesktopOnly: false`** (mobile-safe) — verbatim from `manifest.json`. No desktop-only or Node.js API in any code path.
- **Zero runtime dependencies.** `src/core/**` and `src/vendor/**` must not import `obsidian` or `node:*`. `fflate` may appear only in `tests/**`.
- **Bilingual, EN + DE parity.** Every new user-facing string exists in both `EN` and `DE` in `src/i18n/strings.ts`; the parity test in `tests/i18n/strings.test.ts` must stay green.
- **Author:** `Johannes Kaindl`. **License:** `AGPL-3.0-or-later`.
- **Test commands:** `npm test` (vitest run), `npm run typecheck` (`tsc --noEmit`), `npm run build` (`node esbuild.config.mjs production`).
- **Scope boundary:** the Sidebar (`ItemView` / vendored Hub-View) is **Plan 4**, not this plan. Plan 3 delivers commands + ribbon + folder menu + settings only.

---

## File Structure

**New pure core (node-testable, no `obsidian` import):**
- `src/core/code-blocks.ts` — fenced-code extraction + placeholder + restore (carry-forward #1). Adopted from `obsidian-letterhead/src/core/code-blocks.ts`, renamed prefix + a new `restoreCodeBlocks`.
- `src/core/output-path.ts` — pure output-path resolution + filename sanitisation for the four targets.

**Modified pure core:**
- `src/core/image-registry.ts` — dedup on resolved vault path, not just raw `src` (carry-forward #2).
- `src/core/dom-to-xhtml.ts` — widen the `UNWRAP` set so wrapped images survive (carry-forward #3).

**Modified injected assembler (obsidian-namespaced, still node-testable via fakes):**
- `src/obsidian/book-assembler.ts` — thread extracted `codes` through `RenderedNote` and call `restoreCodeBlocks` after `domToXhtml`.

**New Obsidian edge (imports `obsidian`; typecheck+build only, GUI-smoke verified):**
- `src/obsidian/deps.ts` — concrete `AssemblerDeps` built from `App` (readNote/resolveNotePath/readImage/listFolderNotes/renderMarkdown).
- `src/obsidian/output.ts` — `writeEpub`: the four output targets (beside note / attachment folder / custom folder / share).
- `src/obsidian/settings-tab.ts` — `EpubSettingTab` (output target, custom folder, default language, open-sidebar-on-startup).

**Modified:**
- `src/main.ts` — real `onload`: i18n init, settings load/save, commands, ribbon, folder context-menu, insert-frontmatter, settings tab.
- `src/i18n/strings.ts` — consolidate command keys + add `settings.*` keys.

**New tests:**
- `tests/core/code-blocks.test.ts`, `tests/core/output-path.test.ts`, `tests/epub-e2e.test.ts` (carry-forward #4), plus additions to `tests/core/image-registry.test.ts`, `tests/core/dom-to-xhtml.test.ts`, `tests/obsidian/book-assembler.test.ts`.

---

### Task 1: `code-blocks.ts` — fenced-code extraction + restore (carry-forward #1)

`MarkdownRenderer.render` runs every registered post-processor, including other plugins'. A code-block processor (e.g. a JSON editor on ` ```json `) replaces the `<pre>` with its own widget DOM, and the original code is unrecoverable from it. Fix: pull fenced code out of the Markdown **before** rendering, leave an alphanumeric placeholder, and re-inject real `<pre><code>` **after** `dom-to-xhtml`. Extraction logic is adopted verbatim from `obsidian-letterhead/src/core/code-blocks.ts` (proven, TDD'd); the restore step is new to epub.

**Files:**
- Create: `src/core/code-blocks.ts`
- Test: `tests/core/code-blocks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ExtractedCode { lang?: string; text: string }`
  - `function extractCodeBlocks(md: string): { markdown: string; codes: ExtractedCode[] }`
  - `function codePlaceholder(i: number): string` → `"EPUBEXPORTERCODE<i>"`
  - `function parseCodePlaceholder(text: string): number | null`
  - `function restoreCodeBlocks(xhtml: string, codes: ExtractedCode[]): string` — replaces each `<p>EPUBEXPORTERCODE<i></p>` with `<pre><code[ class="language-<lang>"]>escaped text</code></pre>`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/code-blocks.test.ts
import { describe, it, expect } from "vitest";
import {
  extractCodeBlocks,
  codePlaceholder,
  parseCodePlaceholder,
  restoreCodeBlocks,
} from "../../src/core/code-blocks";

describe("extractCodeBlocks", () => {
  it("replaces a fenced block with a placeholder and captures lang + text", () => {
    const { markdown, codes } = extractCodeBlocks("a\n```json\n{\"x\":1}\n```\nb");
    expect(markdown).toBe(`a\n${codePlaceholder(0)}\nb`);
    expect(codes).toEqual([{ lang: "json", text: '{"x":1}' }]);
  });

  it("keeps an inner shorter fence from closing an outer longer fence", () => {
    const { codes } = extractCodeBlocks("````\n```\nnested\n```\n````");
    expect(codes).toEqual([{ lang: undefined, text: "```\nnested\n```" }]);
  });

  it("leaves an unclosed fence untouched (renderer decides)", () => {
    const { markdown, codes } = extractCodeBlocks("```\nno end");
    expect(markdown).toBe("```\nno end");
    expect(codes).toEqual([]);
  });
});

describe("parseCodePlaceholder", () => {
  it("round-trips codePlaceholder", () => {
    expect(parseCodePlaceholder(codePlaceholder(3))).toBe(3);
    expect(parseCodePlaceholder("not a placeholder")).toBeNull();
  });
});

describe("restoreCodeBlocks", () => {
  it("rebuilds a <pre><code> block with escaped content and a language class", () => {
    const codes = [{ lang: "js", text: "const a = 1 < 2 && 3 > 2;" }];
    const out = restoreCodeBlocks(`<h1>x</h1><p>${codePlaceholder(0)}</p>`, codes);
    expect(out).toBe(
      '<h1>x</h1><pre><code class="language-js">const a = 1 &lt;' +
        " 2 &amp;&amp; 3 &gt; 2;</code></pre>"
    );
  });

  it("omits the language class when lang is absent", () => {
    const out = restoreCodeBlocks(`<p>${codePlaceholder(0)}</p>`, [{ text: "x" }]);
    expect(out).toBe("<pre><code>x</code></pre>");
  });

  it("is a no-op when there are no codes", () => {
    expect(restoreCodeBlocks("<p>hi</p>", [])).toBe("<p>hi</p>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/code-blocks.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/code-blocks'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/code-blocks.ts
export interface ExtractedCode {
  lang?: string;
  text: string;
}

export function codePlaceholder(i: number): string {
  return `EPUBEXPORTERCODE${i}`;
}

const PLACEHOLDER_RE = /^EPUBEXPORTERCODE(\d+)$/;

/** Index of the placeholder this text is, or null. Counterpart to codePlaceholder(). */
export function parseCodePlaceholder(text: string): number | null {
  const m = PLACEHOLDER_RE.exec(text.trim());
  return m ? Number(m[1]) : null;
}

// Opening fence: optional indent, 3+ backticks or tildes, optional language.
const OPEN_RE = /^(\s*)(`{3,}|~{3,})(\S*)\s*$/;

export function extractCodeBlocks(md: string): { markdown: string; codes: ExtractedCode[] } {
  const lines = md.split("\n");
  const out: string[] = [];
  const codes: ExtractedCode[] = [];
  let i = 0;

  while (i < lines.length) {
    const open = OPEN_RE.exec(lines[i]);
    if (!open) { out.push(lines[i]); i++; continue; }

    const [, indent, fence, lang] = open;
    // Closing fence: same char, at least as long, nothing else on the line. This is what
    // keeps a ``` inside a ````-block from ending it early.
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;

    // Unclosed fence: not a code block. Leave the line as-is so the renderer decides.
    if (j >= lines.length) { out.push(lines[i]); i++; continue; }

    const body = lines.slice(i + 1, j).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l));
    codes.push({ lang: lang || undefined, text: body.join("\n") });
    out.push(indent + codePlaceholder(codes.length - 1));
    i = j + 1;
  }

  return { markdown: out.join("\n"), codes };
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

// dom-to-xhtml strips all attributes from <p> (no whitelist entry), so a lone placeholder
// paragraph is always serialized as exactly `<p>EPUBEXPORTERCODEi</p>` regardless of any
// dir/class Obsidian added — which makes this string replacement reliable.
const PLACEHOLDER_P_RE = /<p>EPUBEXPORTERCODE(\d+)<\/p>/g;

export function restoreCodeBlocks(xhtml: string, codes: ExtractedCode[]): string {
  if (codes.length === 0) return xhtml;
  return xhtml.replace(PLACEHOLDER_P_RE, (whole, n) => {
    const code = codes[Number(n)];
    if (!code) return whole;
    const langAttr = code.lang ? ` class="language-${escapeAttr(code.lang)}"` : "";
    return `<pre><code${langAttr}>${escapeText(code.text)}</code></pre>`;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/code-blocks.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/code-blocks.ts tests/core/code-blocks.test.ts
git commit -m "feat(core): fenced-code extract + placeholder + restore (code-block hijack guard)"
```

---

### Task 2: Thread `codes` through the assembler and restore after `dom-to-xhtml`

Wire Task 1 into the one render path Plan 3 verdrahtet. `RenderedNote` gains a `codes` field; the assembler restores code blocks on the XHTML string produced by `domToXhtml`. `dom-to-xhtml` stays frozen — the restore is a pure post-pass.

**Files:**
- Modify: `src/obsidian/book-assembler.ts:16-19` (interface), `:5-7` (imports), `:167` (chapter push)
- Test: `tests/obsidian/book-assembler.test.ts` (add one case; update the fake)

**Interfaces:**
- Consumes: `restoreCodeBlocks`, `ExtractedCode` from Task 1; existing `domToXhtml`.
- Produces: `RenderedNote` now carries `codes: ExtractedCode[]`. The concrete `renderMarkdown` (Task 8) must populate it.

- [ ] **Step 1: Write the failing test**

Add to `tests/obsidian/book-assembler.test.ts`. First extend the fake `renderMarkdown` (line 13-17) to return `codes`, honouring a per-note code map:

```typescript
// Replace makeDeps signature + renderMarkdown in tests/obsidian/book-assembler.test.ts
function makeDeps(
  notes: Record<string, NoteData>,
  images: Record<string, { path: string; n: number }>,
  codes: Record<string, { lang?: string; text: string }[]> = {}
): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown; // test notes provide HTML bodies directly
      return { root, dispose: () => {}, codes: codes[sourcePath] ?? [] };
    },
    // ...unchanged readNote / resolveNotePath / readImage / listFolderNotes
```

Then add a new test:

```typescript
describe("assembleBook — code-block restore", () => {
  it("re-injects extracted fenced code as <pre><code> in the chapter XHTML", async () => {
    // The book-note body already carries the post-render placeholder paragraph;
    // codes[sourcePath] supplies the captured fence, as the real renderMarkdown would.
    const notes = {
      "N.md": note("N.md", "<p>EPUBEXPORTERCODE0</p>", { epub: true, title: "T" }),
    };
    const deps = makeDeps(notes, {}, { "N.md": [{ lang: "js", text: "a<b" }] });
    const { book } = await assembleBook(deps, { kind: "note", path: "N.md" }, opts);
    expect(book.chapters[0].xhtml).toContain('<pre><code class="language-js">a&lt;b</code></pre>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/book-assembler.test.ts`
Expected: FAIL — `RenderedNote` has no `codes` property (type error) and the new assertion fails (raw placeholder still present).

- [ ] **Step 3: Write minimal implementation**

In `src/obsidian/book-assembler.ts`, add the import (after line 7):

```typescript
import { restoreCodeBlocks, ExtractedCode } from "../core/code-blocks";
```

Extend `RenderedNote` (lines 16-19):

```typescript
export interface RenderedNote {
  root: HTMLElement;
  dispose: () => void;
  codes: ExtractedCode[]; // fenced code pulled out before render, re-injected after dom-to-xhtml
}
```

Change the chapter push (line 167) to restore code blocks on the serialized XHTML:

```typescript
      const xhtml = restoreCodeBlocks(domToXhtml(rendered.root, ctx), rendered.codes);
      chapters.push({ title: plan.title, xhtml, sourcePath: plan.sourcePath });
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npx vitest run tests/obsidian/book-assembler.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (the fake and interface now agree).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/book-assembler.ts tests/obsidian/book-assembler.test.ts
git commit -m "feat(assembler): thread extracted codes through RenderedNote + restore after dom-to-xhtml"
```

---

### Task 3: Image dedup on resolved vault path (carry-forward #2)

The cover arrives as a bare filename (`unwrapLink` → `"cov.png"`) while inline images arrive as the renderer's resource URL (`app://…/cov.png?ver`). Keyed on raw `src`, the same asset lands twice under two ids. Fix: keep the fast `bySrc` cache **and** add a canonical `byPath` map keyed on the resolved vault path returned by `read`, so any two srcs that resolve to the same file share one asset. (Task 8's `readImage` returns a stable `path` for both cases.)

**Files:**
- Modify: `src/core/image-registry.ts:26-52`
- Test: `tests/core/image-registry.test.ts` (add one case)

**Interfaces:**
- Consumes: existing `ImageSource { data; path }`.
- Produces: unchanged public API (`resolve(src, sourcePath)`, `images()`); behaviour now dedups across differing srcs that share a resolved `path`.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/image-registry.test.ts`:

```typescript
it("dedups two different srcs that resolve to the same vault path", async () => {
  // "cov.png" (cover) and "app://host/cov.png?9" (inline) → same file "assets/cov.png".
  const reg = new ImageRegistry(async (src) => ({
    data: new Uint8Array([1]),
    path: "assets/cov.png",
  }));
  const a = await reg.resolve("cov.png", "Book.md");
  const b = await reg.resolve("app://host/cov.png?9", "Chapter.md");
  expect(a).not.toBeNull();
  expect(b).toEqual(a); // same id + href
  expect(reg.images()).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/image-registry.test.ts`
Expected: FAIL — `images()` has length 2 and `b` has a different id than `a`.

- [ ] **Step 3: Write minimal implementation**

Replace the class body in `src/core/image-registry.ts` (lines 26-52):

```typescript
export class ImageRegistry {
  private assets: ImageAsset[] = [];
  private bySrc = new Map<string, { id: string; href: string }>();
  private byPath = new Map<string, { id: string; href: string }>();
  private counter = 0;

  constructor(private read: (src: string, sourcePath: string) => Promise<ImageSource | null>) {}

  async resolve(src: string, sourcePath: string): Promise<{ id: string; href: string } | null> {
    const seen = this.bySrc.get(src);
    if (seen) return seen;
    const got = await this.read(src, sourcePath);
    if (!got) return null;
    // Two distinct srcs (bare cover filename vs. inline app:// URL) can resolve to the same
    // vault file; dedup on the resolved path so the asset is embedded once.
    const canon = this.byPath.get(got.path);
    if (canon) {
      this.bySrc.set(src, canon);
      return canon;
    }
    const mediaType = mediaTypeForPath(got.path);
    if (!mediaType) return null;
    this.counter++;
    const id = `img-${String(this.counter).padStart(2, "0")}`;
    const href = `images/${id}.${extOf(got.path)}`;
    this.assets.push({ id, href, mediaType, data: got.data });
    const ref = { id, href };
    this.bySrc.set(src, ref);
    this.byPath.set(got.path, ref);
    return ref;
  }

  images(): ImageAsset[] {
    return this.assets;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/image-registry.test.ts`
Expected: PASS (existing cases + the new dedup case).

- [ ] **Step 5: Commit**

```bash
git add src/core/image-registry.ts tests/core/image-registry.test.ts
git commit -m "fix(core): dedup images on resolved vault path (cover vs inline double-embed)"
```

---

### Task 4: Widen `dom-to-xhtml` unwrap set so wrapped images survive (carry-forward #3)

Only `div/section/article` unwrap; `figure/figcaption/aside/details/header/footer/main/nav` fall into the Unknown branch → `textContent`, losing nested `<img>`/`<a>`. Low real-risk but a `<figure>`-wrapped image would silently vanish. Fix: add these block containers to `UNWRAP` so their children (including images and links) are serialized.

**Files:**
- Modify: `src/core/dom-to-xhtml.ts:19`
- Test: `tests/core/dom-to-xhtml.test.ts` (add one case)

**Interfaces:**
- Consumes / Produces: unchanged public API (`domToXhtml(root, ctx)`); wider container coverage.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/dom-to-xhtml.test.ts` (uses the file's existing jsdom env + context-builder helper; if the file has no helper, build the ctx inline as below):

```typescript
it("unwraps a <figure> and keeps its inner image", () => {
  const root = document.createElement("div");
  root.innerHTML = '<figure><img src="a.png" alt="cap"><figcaption>cap</figcaption></figure>';
  const ctx = {
    resolveImage: (_s: string) => "images/img-01.png",
    resolveInternalLink: (_t: string) => null,
    onUnsupported: (_k: string) => {},
  };
  const out = domToXhtml(root, ctx);
  expect(out).toContain('<img src="images/img-01.png" alt="cap"/>');
  expect(out).toContain("cap"); // figcaption text preserved as loose inline text
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: FAIL — the `<img>` is dropped (figure went through the Unknown/textContent branch), so `out` lacks the `<img …/>` string.

- [ ] **Step 3: Write minimal implementation**

Replace line 19 of `src/core/dom-to-xhtml.ts`:

```typescript
// Generic containers: unwrap (serialize children, drop the wrapper). Includes the common
// HTML5 sectioning/figure wrappers so a wrapped <img>/<a> is not lost to textContent.
const UNWRAP = new Set([
  "div", "section", "article",
  "figure", "figcaption", "aside", "details", "summary", "header", "footer", "main", "nav",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: PASS (existing cases + the figure case).

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-to-xhtml.ts tests/core/dom-to-xhtml.test.ts
git commit -m "fix(core): widen dom-to-xhtml unwrap set so wrapped images/links survive"
```

---

### Task 5: `output-path.ts` — pure output-path resolution + sanitisation

The four output targets need a pure, node-testable path computation (mirrors Paperize's `resolveOutputPath`/`sanitizeBase`, minus the `{version}` counter, which epub does not use). Keeping this pure means the obsidian-side `writeEpub` (Task 9) stays a thin adapter over verified logic.

**Files:**
- Create: `src/core/output-path.ts`
- Test: `tests/core/output-path.test.ts`

**Interfaces:**
- Consumes: `OutputDestination` type — re-declare locally as a string union to keep core free of the obsidian-namespaced settings import (see note in Step 3).
- Produces:
  - `function sanitizeBase(name: string): string`
  - `function resolveOutputPath(dest, opts): string | null` where `dest: "besideNote" | "attachmentFolder" | "customFolder" | "share"` and `opts: { noteDir: string; baseName: string; customFolder: string; attachmentPath: string }`. Returns `null` for `"share"`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/output-path.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeBase, resolveOutputPath } from "../../src/core/output-path";

describe("sanitizeBase", () => {
  it("strips path-hostile characters and falls back when empty", () => {
    expect(sanitizeBase('a/b:c*?"<>|d')).toBe("abcd");
    expect(sanitizeBase("   ")).toBe("Untitled");
  });
});

describe("resolveOutputPath", () => {
  const opts = { noteDir: "Books", baseName: "My Book", customFolder: "Export", attachmentPath: "att/My Book.epub" };
  it("beside the note", () => {
    expect(resolveOutputPath("besideNote", opts)).toBe("Books/My Book.epub");
  });
  it("beside the note at vault root (no dir)", () => {
    expect(resolveOutputPath("besideNote", { ...opts, noteDir: "" })).toBe("My Book.epub");
  });
  it("custom folder", () => {
    expect(resolveOutputPath("customFolder", opts)).toBe("Export/My Book.epub");
  });
  it("attachment folder passes the resolved attachment path through", () => {
    expect(resolveOutputPath("attachmentFolder", opts)).toBe("att/My Book.epub");
  });
  it("share has no vault target", () => {
    expect(resolveOutputPath("share", opts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/output-path.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/output-path'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/output-path.ts
// The four output destinations. Declared here (not imported from src/obsidian/settings.ts)
// so this module stays free of any obsidian-namespaced import and remains node-testable.
export type OutputDestination = "besideNote" | "attachmentFolder" | "customFolder" | "share";

export function sanitizeBase(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || "Untitled";
}

// Join two vault-relative fragments without leading/trailing slash noise.
function joinPath(dir: string, file: string): string {
  const d = (dir || "").replace(/^\/+|\/+$/g, "");
  return d ? `${d}/${file}` : file;
}

export function resolveOutputPath(
  dest: OutputDestination,
  opts: { noteDir: string; baseName: string; customFolder: string; attachmentPath: string }
): string | null {
  if (dest === "share") return null;
  const file = `${sanitizeBase(opts.baseName)}.epub`;
  if (dest === "besideNote") return joinPath(opts.noteDir, file);
  if (dest === "customFolder") return joinPath(opts.customFolder, file);
  // attachmentFolder: attachmentPath is a resolved vault path from getAvailablePathForAttachment.
  return opts.attachmentPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/output-path.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/output-path.ts tests/core/output-path.test.ts
git commit -m "feat(core): pure output-path resolution + filename sanitisation"
```

---

### Task 6: End-to-end test `assembleBook → buildEpub → unzip` (carry-forward #4)

The Plan-2 reviewer verified the composition only ad hoc. Commit a guard: assemble a small book through the fakes, build the EPUB bytes, unzip with `fflate` (dev-only), and assert the archive shape — `mimetype` first + stored, the OPF, one chapter per note, an embedded image, and code-block restore surviving the whole chain.

**Files:**
- Create: `tests/epub-e2e.test.ts`

**Interfaces:**
- Consumes: `assembleBook` (`src/obsidian/book-assembler.ts`), `buildEpub` (`src/core/epub-builder.ts`), `fflate.unzipSync`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/epub-e2e.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { assembleBook, AssemblerDeps, NoteData } from "../src/obsidian/book-assembler";
import { buildEpub } from "../src/core/epub-builder";

const note = (path: string, body: string, fm: Record<string, unknown> = {}): NoteData => ({
  path,
  basename: path.replace(/\.md$/, "").split("/").pop()!,
  frontmatter: fm,
  body,
});

function deps(
  notes: Record<string, NoteData>,
  images: Record<string, { path: string; n: number }>,
  codes: Record<string, { lang?: string; text: string }[]> = {}
): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      const root = document.createElement("div");
      root.innerHTML = markdown;
      return { root, dispose: () => {}, codes: codes[sourcePath] ?? [] };
    },
    async readNote(path) { return notes[path] ?? null; },
    resolveNotePath(target) {
      const withMd = target.endsWith(".md") ? target : target + ".md";
      return notes[withMd] ? withMd : notes[target] ? target : null;
    },
    async readImage(target) {
      const hit = images[target];
      return hit ? { data: new Uint8Array([hit.n, hit.n, hit.n, hit.n]), path: hit.path } : null;
    },
    async listFolderNotes() { return []; },
  };
}

describe("EPUB end-to-end", () => {
  it("assembles a book and builds a valid archive shape", async () => {
    const notes = {
      "Book.md": note("Book.md", '![[Intro]]\n![[Body]]', { epub: true, title: "E2E Book", author: "Jay", language: "en" }),
      "Intro.md": note("Intro.md", "<p>hello</p>"),
      "Body.md": note("Body.md", '<p><img src="pic.png" alt="p"></p><p>EPUBEXPORTERCODE0</p>'),
    };
    const images = { "pic.png": { path: "pic.png", n: 7 } };
    const codes = { "Body.md": [{ lang: "js", text: "x < 1" }] };

    const { book } = await assembleBook(deps(notes, images, codes), { kind: "note", path: "Book.md" }, {
      defaultLanguage: "en",
      rng: () => 0.5,
    });
    const bytes = buildEpub(book);
    const files = unzipSync(bytes);

    // mimetype present with exact content
    expect(strFromU8(files["mimetype"])).toBe("application/epub+zip");
    // container + package + nav present
    expect(files["META-INF/container.xml"]).toBeDefined();
    expect(files["OEBPS/content.opf"]).toBeDefined();
    expect(files["OEBPS/nav.xhtml"]).toBeDefined();
    // one chapter file per plan (Intro, Body)
    expect(files["OEBPS/chapter-01.xhtml"]).toBeDefined();
    expect(files["OEBPS/chapter-02.xhtml"]).toBeDefined();
    // image embedded, code block restored, image src rewritten to images/
    expect(files["OEBPS/images/img-01.png"]).toBeDefined();
    const body = strFromU8(files["OEBPS/chapter-02.xhtml"]);
    expect(body).toContain('src="images/img-01.png"');
    expect(body).toContain("<pre><code");
    expect(body).toContain("x &lt; 1");
    // OPF references the title
    expect(strFromU8(files["OEBPS/content.opf"])).toContain("E2E Book");
  });

  it("keeps mimetype as the first, STORED (uncompressed) entry", async () => {
    const notes = { "N.md": note("N.md", "<p>x</p>", { epub: true, title: "T" }) };
    const { book } = await assembleBook(deps(notes, {}), { kind: "note", path: "N.md" }, {
      defaultLanguage: "en",
      rng: () => 0.5,
    });
    const bytes = buildEpub(book);
    // Local file header of the first entry starts at offset 0; the name field begins at 30.
    const name = strFromU8(bytes.slice(30, 38));
    expect(name).toBe("mimetype");
    // Compression method (offset 8, little-endian u16) must be 0 = stored.
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then confirm it can pass**

Run: `npx vitest run tests/epub-e2e.test.ts`
Expected: PASS if the engine already produces this shape (it does per Plan-2 review). If any assertion fails, it is a **real composition regression** — fix the offending core/assembler code (do not weaken the assertion) before continuing. This test is the guard.

- [ ] **Step 3: Commit**

```bash
git add tests/epub-e2e.test.ts
git commit -m "test: end-to-end assembleBook -> buildEpub -> unzip guard"
```

---

### Task 7: i18n — consolidate command keys + add `settings.*` keys

Plan 2 seeded `cmd.exportBook`/`cmd.exportNote`/`cmd.exportFolder`/`cmd.insertFrontmatter`/`cmd.exportRibbon` and the notices. Plan 3 registers **one** active-file export command + ribbon (auto-detecting book-note vs. single note — the assembler already branches on `isBookNote`), the folder command, and insert-frontmatter. Add the `settings.*` strings the settings tab needs. Keep EN/DE parity.

**Decision (documented):** a single "Export as EPUB" active-file command instead of separate book/note commands — the entry point (active file vs. folder) plus `isBookNote` fully determine behaviour, so two near-identical active-file commands would only add menu noise. `cmd.exportBook`/`cmd.exportNote` keys are removed.

**Files:**
- Modify: `src/i18n/strings.ts`
- Test: `tests/i18n/strings.test.ts` (parity test already exists; it must stay green)

**Interfaces:**
- Produces (final key set): `cmd.export`, `cmd.exportFolder`, `cmd.insertFrontmatter`, `cmd.exportRibbon`, all existing `notice.*`, plus `settings.output.name`, `settings.output.besideNote`, `settings.output.attachmentFolder`, `settings.output.customFolder`, `settings.output.share`, `settings.customFolder.name`, `settings.language.name`, `settings.language.desc`, `settings.openSidebar.name`, `settings.openSidebar.desc`.

- [ ] **Step 1: Update the strings and verify parity**

Edit `src/i18n/strings.ts`. In `EN`, replace the `cmd.exportBook`/`cmd.exportNote` lines with a single `cmd.export` and append the settings keys:

```typescript
export const EN: Record<string, string> = {
  "cmd.export": "Export as EPUB",
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
  "settings.output.name": "Output destination",
  "settings.output.besideNote": "Beside the note",
  "settings.output.attachmentFolder": "Attachment folder",
  "settings.output.customFolder": "Custom folder",
  "settings.output.share": "Share / open in another app",
  "settings.customFolder.name": "Custom folder",
  "settings.language.name": "Default book language",
  "settings.language.desc": "Used when a book note has no language field (e.g. en, de).",
  "settings.openSidebar.name": "Open sidebar on startup",
  "settings.openSidebar.desc": "Automatically reveal the EPUB Exporter panel when Obsidian starts.",
};
```

Apply the exact same key set to `DE` with German values:

```typescript
export const DE: Record<string, string> = {
  "cmd.export": "Als EPUB exportieren",
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
  "settings.output.name": "Ausgabeziel",
  "settings.output.besideNote": "Neben der Notiz",
  "settings.output.attachmentFolder": "Anhang-Ordner",
  "settings.output.customFolder": "Eigener Ordner",
  "settings.output.share": "Teilen / in anderer App öffnen",
  "settings.customFolder.name": "Eigener Ordner",
  "settings.language.name": "Standard-Buchsprache",
  "settings.language.desc": "Wird verwendet, wenn eine Buch-Notiz kein Sprachfeld hat (z.B. en, de).",
  "settings.openSidebar.name": "Seitenleiste beim Start öffnen",
  "settings.openSidebar.desc": "Das EPUB-Exporter-Panel beim Start von Obsidian automatisch einblenden.",
};
```

- [ ] **Step 2: Run the parity test + typecheck**

Run: `npx vitest run tests/i18n/strings.test.ts && npm run typecheck`
Expected: PASS — EN and DE have identical key sets; nothing references the removed `cmd.exportBook`/`cmd.exportNote` yet (main wiring comes in Task 11).

- [ ] **Step 3: Commit**

```bash
git add src/i18n/strings.ts
git commit -m "feat(i18n): consolidate export command + add settings strings (EN/DE)"
```

---

### Task 8: Concrete `AssemblerDeps` from `App` (`src/obsidian/deps.ts`)

The real port bundle: reads notes/images from the vault, resolves links, lists folder notes, and renders Markdown (extracting fenced code first — Task 1). Imports `obsidian`, so it is verified by typecheck + build + the GUI smoke (Task 12), not a unit test (no obsidian mock in this repo).

**Files:**
- Create: `src/obsidian/deps.ts`

**Interfaces:**
- Consumes: `AssemblerDeps`, `NoteData`, `RenderedNote` (`book-assembler.ts`); `ImageSource` (`image-registry.ts`); `extractCodeBlocks` (Task 1); `renderMarkdownToDom` (`render-adapter.ts`).
- Produces: `function createAssemblerDeps(app: App): AssemblerDeps`.

- [ ] **Step 1: Write the implementation**

```typescript
// src/obsidian/deps.ts
import { App, Component, MarkdownRenderer, TFile, TFolder, normalizePath } from "obsidian";
import { AssemblerDeps, NoteData } from "./book-assembler";
import { ImageSource } from "../core/image-registry";
import { extractCodeBlocks } from "../core/code-blocks";

// Strip a leading YAML frontmatter block so the body handed to the renderer has no raw YAML.
function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (m) return content.slice(m[0].length);
  }
  return content;
}

export function createAssemblerDeps(app: App): AssemblerDeps {
  return {
    async renderMarkdown(markdown, sourcePath) {
      // Pull fenced code out BEFORE rendering (other plugins' post-processors would
      // replace the <pre> with unrecoverable widget DOM); re-injected after dom-to-xhtml.
      const { markdown: stripped, codes } = extractCodeBlocks(markdown);
      const root = createDiv();
      const comp = new Component();
      await MarkdownRenderer.render(app, stripped, root, sourcePath, comp);
      return { root, dispose: () => comp.unload(), codes };
    },

    async readNote(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") return null;
      const content = await app.vault.cachedRead(file);
      const frontmatter = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
      const note: NoteData = {
        path: file.path,
        basename: file.basename,
        frontmatter,
        body: stripFrontmatter(content),
      };
      return note;
    },

    resolveNotePath(target, sourcePath) {
      const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      return dest ? dest.path : null;
    },

    async readImage(src, sourcePath): Promise<ImageSource | null> {
      // Normalise every src to a vault TFile so the ImageRegistry dedups on the resolved
      // path (Task 3): the cover arrives as a bare filename, inline images as an app:// URL.
      let dest: TFile | null = null;
      if (/^(app:|capacitor:|https?:|blob:|data:)/i.test(src)) {
        // Renderer resource URL → recover the file by its basename.
        const clean = decodeURIComponent(src.split("?")[0]);
        const base = clean.split("/").pop() ?? clean;
        dest = app.metadataCache.getFirstLinkpathDest(base, sourcePath);
      } else {
        const link = decodeURIComponent(src.replace(/^\.\//, ""));
        dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath)
          ?? (app.vault.getAbstractFileByPath(normalizePath(link)) as TFile | null);
      }
      if (!(dest instanceof TFile)) return null;
      const buf = await app.vault.readBinary(dest);
      return { data: new Uint8Array(buf), path: dest.path };
    },

    async listFolderNotes(folderPath) {
      const folder = app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) return [];
      return folder.children
        .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
        .map((f) => f.path);
    },
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no unit test — obsidian-importing edge file; behaviour is covered by Task 12's GUI smoke).

- [ ] **Step 3: Commit**

```bash
git add src/obsidian/deps.ts
git commit -m "feat(obsidian): concrete AssemblerDeps from App (vault/metadataCache/render)"
```

---

### Task 9: `writeEpub` — the four output targets (`src/obsidian/output.ts`)

Mirror of Paperize's `output.ts`, retargeted to `.epub` and epub's `OutputDestination`. Uses the pure `resolveOutputPath`/`sanitizeBase` from Task 5. Obsidian-importing edge; typecheck + build + GUI smoke.

**Files:**
- Create: `src/obsidian/output.ts`

**Interfaces:**
- Consumes: `resolveOutputPath`, `sanitizeBase`, `OutputDestination` (Task 5); `t` (`../vendor/kit/i18n`).
- Produces: `async function writeEpub(app, bytes, dest, ctx): Promise<{ savedPath: string | null }>` where `ctx: { baseName: string; noteDir: string; customFolder: string; attachmentPath: string }`.

- [ ] **Step 1: Write the implementation**

```typescript
// src/obsidian/output.ts
import { App, Notice } from "obsidian";
import { OutputDestination, resolveOutputPath, sanitizeBase } from "../core/output-path";
import { t } from "../vendor/kit/i18n";

// Runtime-only API surfaces not covered by the public Obsidian typings.
interface ShareCapableNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
}
interface AppWithDefaultApp {
  openWithDefaultApp?: (path: string) => Promise<void>;
}

const MIME = "application/epub+zip";

export async function writeEpub(
  app: App,
  bytes: Uint8Array,
  dest: OutputDestination,
  ctx: { baseName: string; noteDir: string; customFolder: string; attachmentPath: string }
): Promise<{ savedPath: string | null }> {
  const adapter = app.vault.adapter;
  const appExt = app as unknown as AppWithDefaultApp;
  const safe = `${sanitizeBase(ctx.baseName)}.epub`;

  if (dest === "share") {
    const dir = ".epub-export";
    const path = `${dir}/${safe}`;
    if (await adapter.exists(dir)) {
      const l = await adapter.list(dir);
      for (const f of l.files) await adapter.remove(f);
    } else {
      await adapter.mkdir(dir);
    }
    await adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
    const fileObj = typeof File === "function" ? new File([bytes as BlobPart], safe, { type: MIME }) : null;
    const nav = navigator as ShareCapableNavigator;
    if (fileObj && nav.canShare?.({ files: [fileObj] }) && nav.share) {
      try {
        await nav.share({ files: [fileObj] });
        new Notice(t("notice.shared"));
        return { savedPath: null };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return { savedPath: null };
      }
    }
    if (typeof appExt.openWithDefaultApp === "function") await appExt.openWithDefaultApp(path);
    new Notice(t("notice.shared"));
    return { savedPath: null };
  }

  const path = resolveOutputPath(dest, {
    noteDir: ctx.noteDir,
    baseName: ctx.baseName,
    customFolder: ctx.customFolder,
    attachmentPath: ctx.attachmentPath,
  });
  // Only "share" yields null; the guard keeps TypeScript happy and is defensive.
  if (path === null) return { savedPath: null };
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
  await adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
  new Notice(t("notice.saved", path));
  return { savedPath: path };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/obsidian/output.ts
git commit -m "feat(obsidian): writeEpub — four output targets (beside/attachment/custom/share)"
```

---

### Task 10: `EpubSettingTab` (`src/obsidian/settings-tab.ts`)

Output target dropdown (+ conditional custom-folder row), default book language, and the opt-in `openSidebarOnStartup` toggle. Structure mirrors Paperize's `PaperizeSettingTab`; strings from Task 7. Obsidian-importing edge; typecheck + build + GUI smoke.

**Files:**
- Create: `src/obsidian/settings-tab.ts`

**Interfaces:**
- Consumes: `EpubExporterSettings`, `OutputDestination` (`./settings`); `t` (`../vendor/kit/i18n`).
- Produces: `class EpubSettingTab extends PluginSettingTab`, constructed with `(app, plugin)` where `plugin: { settings: EpubExporterSettings; saveSettings: () => Promise<void> }`.

- [ ] **Step 1: Write the implementation**

```typescript
// src/obsidian/settings-tab.ts
import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EpubExporterSettings, OutputDestination } from "./settings";
import { t } from "../vendor/kit/i18n";

export class EpubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: { settings: EpubExporterSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin as unknown as Plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl).setName(t("settings.output.name")).addDropdown((d) =>
      d
        .addOptions({
          besideNote: t("settings.output.besideNote"),
          attachmentFolder: t("settings.output.attachmentFolder"),
          customFolder: t("settings.output.customFolder"),
          share: t("settings.output.share"),
        })
        .setValue(s.outputDestination)
        .onChange(async (v) => {
          s.outputDestination = v as OutputDestination;
          await save();
          // The custom-folder row is conditional on the mode; re-render is Obsidian's
          // supported way to show/hide dependent settings.
          this.display();
        })
    );

    // Only visible in the matching mode — so it needs no "only when X" helper text.
    if (s.outputDestination === "customFolder") {
      new Setting(containerEl)
        .setName(t("settings.customFolder.name"))
        .addText((txt) => txt.setValue(s.customFolder).onChange(async (v) => {
          s.customFolder = v.trim();
          await save();
        }));
    }

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addText((txt) => txt.setValue(s.defaultLanguage).onChange(async (v) => {
        s.defaultLanguage = v.trim() || "en";
        await save();
      }));

    new Setting(containerEl)
      .setName(t("settings.openSidebar.name"))
      .setDesc(t("settings.openSidebar.desc"))
      .addToggle((tg) => tg.setValue(s.openSidebarOnStartup).onChange(async (v) => {
        s.openSidebarOnStartup = v;
        await save();
      }));
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/obsidian/settings-tab.ts
git commit -m "feat(obsidian): EpubSettingTab (output target, language, sidebar opt-in)"
```

---

### Task 11: Wire `main.ts` — commands, ribbon, folder menu, insert-frontmatter, settings

The integration seam. `onload`: init i18n + language, load settings, register the active-file export command + ribbon, the folder context-menu, the insert-frontmatter command, and the settings tab. The export flow resolves the active file → `assembleBook` (via Task 8 deps) → `buildEpub` → `writeEpub` (Task 9), surfacing broken-embed / simplified notices.

**Files:**
- Modify: `src/main.ts` (full rewrite of the stub)

**Interfaces:**
- Consumes: everything from Tasks 5–10 plus `assembleBook`/`BookSource` (`book-assembler.ts`), `buildEpub` (`epub-builder.ts`), `coerceSettings`/`EpubExporterSettings` (`settings.ts`), `BOOK_FRONTMATTER_TEMPLATE` (`frontmatter.ts`), `t`/`setLang`/`pickLang` (`vendor/kit/i18n`), `registerI18n` (`i18n/strings.ts`).

- [ ] **Step 1: Write the implementation**

```typescript
// src/main.ts
import { Plugin, Notice, TFile, TFolder, Menu, getLanguage, normalizePath } from "obsidian";
import { assembleBook, BookSource } from "./obsidian/book-assembler";
import { buildEpub } from "./core/epub-builder";
import { createAssemblerDeps } from "./obsidian/deps";
import { writeEpub } from "./obsidian/output";
import { EpubSettingTab } from "./obsidian/settings-tab";
import { coerceSettings, EpubExporterSettings } from "./obsidian/settings";
import { BOOK_FRONTMATTER_TEMPLATE } from "./core/frontmatter";
import { registerI18n } from "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";

// Runtime-only Obsidian API not in the public typings.
interface FileManagerExt {
  getAvailablePathForAttachment?: (filename: string, sourcePath: string) => Promise<string>;
}

function readObsidianLocale(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class EpubExporterPlugin extends Plugin {
  settings: EpubExporterSettings = coerceSettings(null);

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(readObsidianLocale()));
    await this.loadSettings();

    this.addSettingTab(new EpubSettingTab(this.app, this));

    this.addRibbonIcon("book", t("cmd.exportRibbon"), () => { void this.exportActive(); });

    this.addCommand({ id: "export-epub", name: t("cmd.export"), callback: () => { void this.exportActive(); } });
    this.addCommand({ id: "insert-book-frontmatter", name: t("cmd.insertFrontmatter"), callback: () => { void this.insertFrontmatter(); } });

    // Right-click a folder → export it as a book (filename-sorted spine).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.exportFolder")).setIcon("book").onClick(() => {
              void this.exportSource({ kind: "folder", path: file.path });
            })
          );
        }
      })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = coerceSettings(await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async exportActive(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
    await this.exportSource({ kind: "note", path: file.path });
  }

  private async exportSource(source: BookSource): Promise<void> {
    try {
      const deps = createAssemblerDeps(this.app);
      const { book, simplifiedCount, missing } = await assembleBook(deps, source, {
        defaultLanguage: this.settings.defaultLanguage,
      });
      if (book.chapters.length === 0) { new Notice(t("notice.noChapters")); return; }
      // Stamp the real modification time (EPUB3 dcterms:modified) — the engine leaves it to the plugin.
      book.metadata.modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

      const bytes = buildEpub(book);
      const { noteDir, baseName } = this.outputContextFor(source, book.metadata.title);
      const attachmentPath = this.settings.outputDestination === "attachmentFolder"
        ? await this.attachmentPathFor(source.path, baseName)
        : "";

      await writeEpub(this.app, bytes, this.settings.outputDestination, {
        baseName,
        noteDir,
        customFolder: this.settings.customFolder,
        attachmentPath,
      });

      if (missing.length > 0) new Notice(t("notice.brokenEmbed", missing.length));
      if (simplifiedCount > 0) new Notice(t("notice.simplified", simplifiedCount));
    } catch (e) {
      console.error("EPUB Exporter: export failed", e);
      new Notice(t("notice.exportFailed"));
    }
  }

  // The note directory + display base name for the output path.
  private outputContextFor(source: BookSource, title: string): { noteDir: string; baseName: string } {
    if (source.kind === "folder") {
      const slash = source.path.lastIndexOf("/");
      const parent = slash === -1 ? "" : source.path.slice(0, slash);
      return { noteDir: parent, baseName: title };
    }
    const file = this.app.vault.getAbstractFileByPath(source.path);
    const dir = file instanceof TFile && file.parent ? file.parent.path : "";
    return { noteDir: dir === "/" ? "" : dir, baseName: title };
  }

  private async attachmentPathFor(sourcePath: string, baseName: string): Promise<string> {
    const fm = this.app.fileManager as unknown as FileManagerExt;
    if (typeof fm.getAvailablePathForAttachment === "function") {
      return normalizePath(await fm.getAvailablePathForAttachment(`${baseName}.epub`, sourcePath));
    }
    return normalizePath(`${baseName}.epub`);
  }

  private async insertFrontmatter(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice(t("notice.noActiveNote")); return; }
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Add each template field only if absent — never overwrite user values.
        for (const [key, value] of Object.entries(BOOK_FRONTMATTER_TEMPLATE)) {
          if (fm[key] === undefined) fm[key] = Array.isArray(value) ? [...value] : value;
        }
      });
      new Notice(t("notice.fmAdded"));
    } catch (e) {
      console.error("EPUB Exporter: frontmatter insert failed", e);
      new Notice(t("notice.fmFailed"));
    }
  }
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS; `main.js` is regenerated. If the build errors on an unused import or a type mismatch, fix it here (do not suppress with `any` beyond the documented runtime-only interfaces).

- [ ] **Step 3: Run the full test suite (guard against regressions)**

Run: `npm test`
Expected: PASS — all prior suites plus Tasks 1–7 additions.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts main.js
git commit -m "feat(obsidian): wire main — export command/ribbon, folder menu, insert-frontmatter, settings"
```

---

### Task 12: GUI smoke test (`/user-handover`) + optional epubcheck gate

The edge files (Tasks 8–11) have no unit tests by design; this is their verification. Produce a `/user-handover` checklist for Jay to run in Obsidian against a real vault, plus the optional epubcheck gate (carry-forward #5) if the tool is available.

**Files:** none (handover note only).

- [ ] **Step 1: Build the plugin into a test vault**

Confirm `npm run build` is green and `main.js` + `manifest.json` are current. Note the plugin folder path for the handover (the repo itself can be symlinked into a vault's `.obsidian/plugins/epub-exporter/`, or the three files copied).

- [ ] **Step 2: Generate the `/user-handover` checklist**

Invoke the `user-handover` skill to produce an abhakbare note for Jay covering, at minimum:
  1. Enable the plugin; confirm the ribbon icon + the three commands appear (Export as EPUB, Insert book frontmatter, and the folder right-click "Export folder as EPUB").
  2. On a plain note: run "Insert book frontmatter" → confirm the `epub: true` field-set is added without clobbering existing keys.
  3. On a book note with `![[embeds]]` and a `cover:` image: run "Export as EPUB" → confirm an `.epub` lands at the configured destination.
  4. Open the `.epub` in a reader (or Calibre) → confirm chapters, TOC, cover, an embedded image, an internal cross-chapter link, and a fenced **code block** all render (code-block hijack guard).
  5. Toggle each output destination in settings (beside note / attachment / custom folder / share) → confirm each writes/shares correctly; on mobile confirm the share sheet appears.
  6. Confirm broken-embed and "N elements simplified" notices appear when expected.

- [ ] **Step 3: Optional — epubcheck gate (carry-forward #5)**

If `epubcheck` is installed (`brew install epubcheck`), run it against a generated file:

Run: `epubcheck /path/to/exported.epub`
Expected: `No errors or warnings detected`. Record the result in the cockpit. If unavailable, note it as a deferred gate — do not block the plan on it.

- [ ] **Step 4: No code commit** — this task's output is the handover note and the recorded smoke result.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-18-epub-exporter-design.md`, Phase 1 row):
- Insert book frontmatter → Task 11 (`insertFrontmatter` + `BOOK_FRONTMATTER_TEMPLATE`). ✓
- Single note → EPUB and Book note (embeds) → EPUB → Task 11 `exportActive` → `assembleBook` note-kind (auto-detects via `isBookNote`). ✓
- Folder → EPUB → Task 11 folder context-menu → `assembleBook` folder-kind. ✓
- Metadata + cover + TOC + internal links + images + code blocks → existing engine (Plan 1/2) + Task 1 (code) + Task 3 (cover dedup) + Task 4 (wrapped images) + verified by Task 6 E2E. ✓
- Four output targets → Task 5 (pure) + Task 9 (`writeEpub`). ✓
- i18n (EN/DE, follows Obsidian) → Task 7 + `setLang(pickLang(getLanguage()))` in Task 11. ✓
- Settings tab (output target · custom folder · openSidebarOnStartup · default language) → Task 10. ✓
- **Sidebar** → **explicitly deferred to Plan 4** (Global Constraints); the spec lists it under Phase 1 but the roadmap splits runtime shell (Plan 3) from sidebar (Plan 4). Not a gap — a documented plan boundary.
- Fußnoten (footnotes) → handled by Obsidian's renderer + `dom-to-xhtml` block passthrough already; no new Plan-3 task. If the smoke test (Task 12) shows footnotes degrading, that is a follow-up, not a Plan-3 deliverable.

**2. Placeholder scan:** No "TBD"/"handle appropriately"/"similar to Task N" — every code step carries full code; every edge task states its exact verification (typecheck/build/smoke). ✓

**3. Type consistency:**
- `RenderedNote.codes: ExtractedCode[]` defined in Task 2, produced by Task 8's `renderMarkdown`, consumed by the assembler's `restoreCodeBlocks(…, rendered.codes)` — names match. ✓
- `OutputDestination` union is identical in `src/obsidian/settings.ts` (existing) and `src/core/output-path.ts` (Task 5, re-declared locally with the same four members) — Task 9 imports the core one; Task 10 imports the settings one; both unions are structurally equal. ✓ (Noted as an intentional duplication to keep core obsidian-free.)
- `writeEpub(app, bytes, dest, ctx)` ctx shape `{ baseName; noteDir; customFolder; attachmentPath }` defined in Task 9, called with exactly those keys in Task 11. ✓
- `createAssemblerDeps(app)` (Task 8) → `AssemblerDeps` consumed by `assembleBook` (Task 11). ✓
- `assembleBook` opts `{ defaultLanguage }` — Task 11 passes `defaultLanguage: this.settings.defaultLanguage`; `rng` omitted (real UUID). ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-epub-exporter-phase1-plan3-runtime-shell.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks; fast iteration, adversarial per-task gate (this repo's Plan 1/2 cadence — it caught the sourcePath bug).

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

**Which approach?**
