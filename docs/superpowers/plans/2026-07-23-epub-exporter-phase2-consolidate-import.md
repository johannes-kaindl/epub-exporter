# EPUB Exporter Phase 2 — Consolidate & Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two Phase-2 representation transitions — *Consolidate to folder* (book note → self-contained folder) and *Import folder as book* (folder → book note) — as explicit one-way actions.

**Architecture:** Same 3-layer ethos as Phase 1. All decision logic lives in **pure** `src/core/*` planners (node-testable, no `obsidian` import). Obsidian touches sit behind thin **ports** (mirroring `AssemblerDeps`/`createAssemblerDeps`): a `ConsolidatePort` executor is node-tested against a fake port; gather-from-Obsidian and the `Modal` UI are the untested thin edges verified by GUI smoke.

**Tech Stack:** TypeScript · esbuild · vitest · vendored obsidian-kit (i18n/settings). Dep-free runtime.

## Global Constraints

- `minAppVersion` is **1.8.7** — no 1.13-only APIs in load-bearing paths. Declarative settings rows stay **static** (no `visible` predicate); keep the `display()` fallback in sync.
- **No inline `// eslint-disable`** anywhere in `src/` (Store gate, `check-no-inline-disables.mjs`). Genuine exceptions go file-scoped in `eslint.config.mjs` with a reason.
- `src/core/*` and `src/vendor/*` must **not** import `obsidian` (`npm run check:pure` enforces both quote styles).
- i18n is bilingual EN/DE in `src/i18n/strings.ts`; a parity test holds the key sets equal — every new key needs both languages.
- Conventional Commits; SemVer tags without `v`; stage only touched files; `main.js` is a gitignored build artifact — never commit it.
- Gate before any commit that changes behavior: `npm run gate` (typecheck + test + check:pure + lint + build).
- **Assets are always copied, never moved** — even in move mode (images are often shared across notes).
- Chapter target filenames carry a running number prefix (`NN - Title.md`), so the number alone guarantees uniqueness — no title de-collision needed. Only the **folder name** (vs. siblings) and **asset filenames** (vs. each other) can collide.

---

## File Structure

**New pure core (node-testable):**
- `src/core/consolidate-plan.ts` — `buildConsolidatePlan(input) → ConsolidatePlan`: folder/chapter naming, collision suffix, embed-spine body, asset copy list + per-chapter rewrites, cover rewrite, skipped count.
- `src/core/import-plan.ts` — `buildImportPlan(folderName, filenames, defaults) → ImportPlan`: folder-note name, frontmatter scaffold, sorted embed body.
- `src/core/image-refs.ts` — `extractImageRefs(body) → string[]` and `rewriteImageRefs(body, rewrites) → string`: pure markdown image-reference extraction and rewriting.

**New Obsidian adapters (thin):**
- `src/obsidian/consolidate.ts` — `ConsolidatePort` interface, `createConsolidatePort(app)`, `gatherConsolidateInput(app, bookFile, assetMode)`, `executeConsolidatePlan(port, plan, ctx)`.
- `src/obsidian/import.ts` — `createImportPort(app)`, `executeImport(port, plan)`.
- `src/obsidian/consolidate-modal.ts` — `ConsolidateModal` (Obsidian `Modal`): preview + two dropdowns + confirm.

**Modified:**
- `src/obsidian/settings.ts` — add `consolidateChapterMode`, `consolidateAssetMode` + defaults.
- `src/obsidian/settings-tab.ts` — add two dropdowns to `getSettingDefinitions()` and `display()`.
- `src/core/sidebar-model.ts` — extend `SidebarHandlers` (via render) with a consolidate action; model unchanged.
- `src/obsidian/sidebar-render.ts` — add `[Consolidate to folder]` button in the book context.
- `src/i18n/strings.ts` — new EN/DE keys.
- `src/main.ts` — commands, folder/book-note file-menu items, modal wiring, sidebar handler.
- `styles.css` — minimal modal styling.

**Entry-points (decided):**
- **Consolidate**: Command (active book note) · Sidebar button (book context) · file-menu on a book-note `TFile`. All open `ConsolidateModal`.
- **Import**: file-menu on a `TFolder` only (mirrors the existing folder-export entry-point; the sidebar has no folder context, so — per YAGNI — Import is not a sidebar button. Documented deviation from spec §5 table.)

---

## Task 1: Pure consolidate planner — core (naming, spine, skipped)

**Files:**
- Create: `src/core/consolidate-plan.ts`
- Test: `tests/consolidate-plan.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
```ts
export type ChapterMode = "copy" | "move";
export type AssetMode = "full" | "cover" | "none";

export interface ResolvedImageRef {
  raw: string;                 // inner ref as written, e.g. "bild.png" or "sub/foo.jpg"
  resolvedPath: string | null; // vault path, null if unresolved
}

export interface ConsolidateChapterInput {
  sourcePath: string | null;   // null when the embed is broken/missing
  title: string;               // chapter_title || basename
  imageRefs: ResolvedImageRef[]; // empty unless assetMode === "full"
}

export interface ConsolidateInput {
  bookTitle: string;
  chapters: ConsolidateChapterInput[]; // spine order; broken entries have sourcePath null
  leadingProse: string;                // book-note body minus embed lines (may be "")
  coverPath: string | null;            // resolved cover image vault path (null if none)
  assetMode: AssetMode;
  existingFolderNames: string[];       // sibling names in parent dir (collision check)
}

export interface AssetCopy { sourcePath: string; targetName: string; } // targetName e.g. "_assets/foo.png"
export interface PlannedChapterOp {
  sourcePath: string;
  targetName: string;                            // "NN - Title.md"
  rewrites: Array<{ from: string; to: string }>; // image ref rewrites (empty unless full)
}
export interface ConsolidatePlan {
  folderName: string;   // sanitized, collision-suffixed, basename only
  bookNoteName: string; // "<folderName>.md"
  bookNoteBody: string; // leadingProse + blank line + embed lines
  chapters: PlannedChapterOp[];
  assets: AssetCopy[];
  coverRewrite: string | null; // new cover frontmatter value, e.g. "[[_assets/cover.png]]"; null = leave as-is
  skipped: number;
}
```
This task ships the core (naming/spine/skipped); **assets and coverRewrite stay empty/null** — Task 3 fills them. Reuse `sanitizeBase` from `../core/output-path`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/consolidate-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildConsolidatePlan, ConsolidateInput } from "../src/core/consolidate-plan";

function baseInput(over: Partial<ConsolidateInput> = {}): ConsolidateInput {
  return {
    bookTitle: "Der Titel des Buchs",
    chapters: [
      { sourcePath: "notes/Vorwort.md", title: "Vorwort", imageRefs: [] },
      { sourcePath: "notes/Einleitung.md", title: "Einleitung", imageRefs: [] },
    ],
    leadingProse: "",
    coverPath: null,
    assetMode: "none",
    existingFolderNames: [],
    ...over,
  };
}

describe("buildConsolidatePlan core", () => {
  it("names folder and book note from the sanitized title", () => {
    const p = buildConsolidatePlan(baseInput());
    expect(p.folderName).toBe("Der Titel des Buchs");
    expect(p.bookNoteName).toBe("Der Titel des Buchs.md");
  });

  it("numbers chapters in spine order with a padded prefix", () => {
    const p = buildConsolidatePlan(baseInput());
    expect(p.chapters.map((c) => c.targetName)).toEqual([
      "01 - Vorwort.md",
      "02 - Einleitung.md",
    ]);
    expect(p.chapters[0].sourcePath).toBe("notes/Vorwort.md");
  });

  it("builds an embed spine body, prefixing leading prose when present", () => {
    const p = buildConsolidatePlan(baseInput({ leadingProse: "Eine Widmung." }));
    expect(p.bookNoteBody).toBe(
      "Eine Widmung.\n\n![[01 - Vorwort]]\n![[02 - Einleitung]]"
    );
  });

  it("omits broken embeds and counts them as skipped", () => {
    const p = buildConsolidatePlan(
      baseInput({
        chapters: [
          { sourcePath: "notes/A.md", title: "A", imageRefs: [] },
          { sourcePath: null, title: "Broken", imageRefs: [] },
          { sourcePath: "notes/B.md", title: "B", imageRefs: [] },
        ],
      })
    );
    expect(p.chapters.map((c) => c.targetName)).toEqual(["01 - A.md", "02 - B.md"]);
    expect(p.skipped).toBe(1);
  });

  it("suffixes the folder name on collision with a sibling", () => {
    const p = buildConsolidatePlan(
      baseInput({ existingFolderNames: ["Der Titel des Buchs", "Der Titel des Buchs (2)"] })
    );
    expect(p.folderName).toBe("Der Titel des Buchs (3)");
    expect(p.bookNoteName).toBe("Der Titel des Buchs (3).md");
  });

  it("sanitizes illegal filename characters in the title", () => {
    const p = buildConsolidatePlan(baseInput({ bookTitle: "A/B: C?" }));
    expect(p.folderName).toBe("AB C");
  });

  it("pads chapter numbers to the width of the largest index", () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      sourcePath: `n/${i}.md`, title: `T${i}`, imageRefs: [],
    }));
    const p = buildConsolidatePlan(baseInput({ chapters }));
    expect(p.chapters[0].targetName).toBe("01 - T0.md");
    expect(p.chapters[11].targetName).toBe("12 - T11.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/consolidate-plan.test.ts`
Expected: FAIL — `buildConsolidatePlan` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/consolidate-plan.ts
import { sanitizeBase } from "./output-path";

export type ChapterMode = "copy" | "move";
export type AssetMode = "full" | "cover" | "none";

export interface ResolvedImageRef {
  raw: string;
  resolvedPath: string | null;
}
export interface ConsolidateChapterInput {
  sourcePath: string | null;
  title: string;
  imageRefs: ResolvedImageRef[];
}
export interface ConsolidateInput {
  bookTitle: string;
  chapters: ConsolidateChapterInput[];
  leadingProse: string;
  coverPath: string | null;
  assetMode: AssetMode;
  existingFolderNames: string[];
}
export interface AssetCopy {
  sourcePath: string;
  targetName: string;
}
export interface PlannedChapterOp {
  sourcePath: string;
  targetName: string;
  rewrites: Array<{ from: string; to: string }>;
}
export interface ConsolidatePlan {
  folderName: string;
  bookNoteName: string;
  bookNoteBody: string;
  chapters: PlannedChapterOp[];
  assets: AssetCopy[];
  coverRewrite: string | null;
  skipped: number;
}

function uniqueFolderName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function buildConsolidatePlan(input: ConsolidateInput): ConsolidatePlan {
  const folderName = uniqueFolderName(sanitizeBase(input.bookTitle), input.existingFolderNames);

  const present = input.chapters.filter(
    (c): c is ConsolidateChapterInput & { sourcePath: string } => c.sourcePath !== null
  );
  const skipped = input.chapters.length - present.length;
  const width = Math.max(2, String(present.length).length);

  const chapters: PlannedChapterOp[] = present.map((c, i) => {
    const num = String(i + 1).padStart(width, "0");
    return {
      sourcePath: c.sourcePath,
      targetName: `${num} - ${sanitizeBase(c.title)}.md`,
      rewrites: [],
    };
  });

  const embedLines = chapters
    .map((c) => `![[${c.targetName.replace(/\.md$/i, "")}]]`)
    .join("\n");
  const prose = input.leadingProse.trim();
  const bookNoteBody = prose ? `${prose}\n\n${embedLines}` : embedLines;

  return {
    folderName,
    bookNoteName: `${folderName}.md`,
    bookNoteBody,
    chapters,
    assets: [],
    coverRewrite: null,
    skipped,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/consolidate-plan.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/consolidate-plan.ts tests/consolidate-plan.test.ts
git commit -m "feat(core): consolidate planner core (naming, spine, skipped)"
```

---

## Task 2: Pure image-reference extract & rewrite

**Files:**
- Create: `src/core/image-refs.ts`
- Test: `tests/image-refs.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
```ts
export function extractImageRefs(body: string): string[]; // inner refs of image embeds/links, in order, deduped
export function rewriteImageRefs(body: string, rewrites: Array<{ from: string; to: string }>): string;
```
`extractImageRefs` returns the inner target of `![[img.ext]]` (only when `ext` is an image extension) and the URL of `![](url)`. `rewriteImageRefs` replaces each `from` occurrence inside `![[from]]` / `![](from)` with `to`.

Image extensions: `png jpg jpeg gif svg webp bmp avif`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/image-refs.test.ts
import { describe, it, expect } from "vitest";
import { extractImageRefs, rewriteImageRefs } from "../src/core/image-refs";

describe("extractImageRefs", () => {
  it("pulls wikilink image embeds but not note embeds", () => {
    const body = "![[cover.png]]\n![[Chapter One]]\ntext ![[deep/pic.jpg]] more";
    expect(extractImageRefs(body)).toEqual(["cover.png", "deep/pic.jpg"]);
  });

  it("pulls markdown image links", () => {
    expect(extractImageRefs("![alt](assets/x.webp)")).toEqual(["assets/x.webp"]);
  });

  it("dedupes repeated refs, preserving first order", () => {
    expect(extractImageRefs("![[a.png]] ![[a.png]] ![[b.gif]]")).toEqual(["a.png", "b.gif"]);
  });

  it("ignores non-image wikilink embeds", () => {
    expect(extractImageRefs("![[note]] ![[data.csv]]")).toEqual([]);
  });
});

describe("rewriteImageRefs", () => {
  it("rewrites wikilink and markdown image refs", () => {
    const body = "![[cover.png]] and ![alt](sub/x.jpg)";
    const out = rewriteImageRefs(body, [
      { from: "cover.png", to: "_assets/cover.png" },
      { from: "sub/x.jpg", to: "_assets/x.jpg" },
    ]);
    expect(out).toBe("![[_assets/cover.png]] and ![alt](_assets/x.jpg)");
  });

  it("leaves refs without a matching rewrite untouched", () => {
    expect(rewriteImageRefs("![[a.png]]", [])).toBe("![[a.png]]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/image-refs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/image-refs.ts
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

// Inner ref of an image wikilink embed: strip alias/heading, keep the path.
function innerTarget(raw: string): string {
  return raw.split("|")[0].split("#")[0].trim();
}

export function extractImageRefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ref: string): void => {
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  };

  // Wikilink embeds: ![[ ... ]] — only when the target has an image extension.
  for (const m of body.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const target = innerTarget(m[1]);
    if (IMAGE_EXT.test(target)) push(target);
  }
  // Markdown image links: ![alt](url) — always an image.
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    push(m[1].trim());
  }
  return out;
}

export function rewriteImageRefs(
  body: string,
  rewrites: Array<{ from: string; to: string }>
): string {
  const map = new Map(rewrites.map((r) => [r.from, r.to]));
  let out = body.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const target = innerTarget(inner);
    const to = map.get(target);
    return to ? `![[${to}]]` : whole;
  });
  out = out.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, pre: string, url: string, post: string) => {
    const to = map.get(url.trim());
    return to ? `${pre}${to}${post}` : whole;
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/image-refs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/image-refs.ts tests/image-refs.test.ts
git commit -m "feat(core): pure image-ref extract & rewrite"
```

---

## Task 3: Asset planning in the consolidate planner

**Files:**
- Modify: `src/core/consolidate-plan.ts`
- Test: `tests/consolidate-plan.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ResolvedImageRef`, `AssetMode` (Task 1); no new exports.
- Produces: fills `plan.assets`, `plan.chapters[i].rewrites`, `plan.coverRewrite`.

Behaviour:
- `assetMode === "none"`: no assets, no rewrites, `coverRewrite = null`.
- `assetMode === "cover"`: copy only the cover (if `coverPath`) to `_assets/<filename>`; `coverRewrite = "[[_assets/<filename>]]"`. No chapter image rewrites.
- `assetMode === "full"`: copy the cover **and** every chapter's resolved `imageRefs`. Dedupe by source vault path → one `_assets/<name>` entry. On filename collision between *different* source paths, suffix the basename (`name.png`, `name (2).png`). Each chapter gets `rewrites` mapping its `raw` ref → the relative `_assets/...` target; unresolved refs are skipped.

Basename helper: filename after the last `/`.

- [ ] **Step 1: Write the failing test (append to tests/consolidate-plan.test.ts)**

```ts
describe("buildConsolidatePlan assets", () => {
  it("none mode carries no assets and no cover rewrite", () => {
    const p = buildConsolidatePlan(
      baseInput({ assetMode: "none", coverPath: "img/cover.png" })
    );
    expect(p.assets).toEqual([]);
    expect(p.coverRewrite).toBeNull();
  });

  it("cover mode copies only the cover and rewrites the cover value", () => {
    const p = buildConsolidatePlan(
      baseInput({ assetMode: "cover", coverPath: "img/cover.png" })
    );
    expect(p.assets).toEqual([{ sourcePath: "img/cover.png", targetName: "_assets/cover.png" }]);
    expect(p.coverRewrite).toBe("[[_assets/cover.png]]");
    expect(p.chapters.every((c) => c.rewrites.length === 0)).toBe(true);
  });

  it("full mode copies cover + chapter images and rewrites chapter refs", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: "img/cover.png",
        chapters: [
          {
            sourcePath: "notes/A.md",
            title: "A",
            imageRefs: [{ raw: "pic.png", resolvedPath: "media/pic.png" }],
          },
        ],
      })
    );
    expect(p.assets).toContainEqual({ sourcePath: "img/cover.png", targetName: "_assets/cover.png" });
    expect(p.assets).toContainEqual({ sourcePath: "media/pic.png", targetName: "_assets/pic.png" });
    expect(p.chapters[0].rewrites).toEqual([{ from: "pic.png", to: "_assets/pic.png" }]);
  });

  it("full mode dedupes the same source path across chapters", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [
          { sourcePath: "a.md", title: "A", imageRefs: [{ raw: "x.png", resolvedPath: "m/x.png" }] },
          { sourcePath: "b.md", title: "B", imageRefs: [{ raw: "x.png", resolvedPath: "m/x.png" }] },
        ],
      })
    );
    expect(p.assets.filter((a) => a.sourcePath === "m/x.png")).toHaveLength(1);
  });

  it("full mode suffixes colliding basenames from different sources", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [
          { sourcePath: "a.md", title: "A", imageRefs: [{ raw: "one/pic.png", resolvedPath: "one/pic.png" }] },
          { sourcePath: "b.md", title: "B", imageRefs: [{ raw: "two/pic.png", resolvedPath: "two/pic.png" }] },
        ],
      })
    );
    expect(p.assets.map((a) => a.targetName).sort()).toEqual([
      "_assets/pic (2).png",
      "_assets/pic.png",
    ]);
    expect(p.chapters[1].rewrites[0].to).toBe("_assets/pic (2).png");
  });

  it("full mode skips unresolved refs", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [{ sourcePath: "a.md", title: "A", imageRefs: [{ raw: "gone.png", resolvedPath: null }] }],
      })
    );
    expect(p.assets).toEqual([]);
    expect(p.chapters[0].rewrites).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/consolidate-plan.test.ts`
Expected: FAIL — asset assertions fail (assets empty).

- [ ] **Step 3: Write minimal implementation**

Add near the top of `consolidate-plan.ts`:

```ts
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

interface AssetPlanState {
  assets: AssetCopy[];
  bySource: Map<string, string>; // source vault path -> "_assets/<finalName>"
  usedNames: Set<string>;        // final _assets/ names already taken
}

// Register a source path as an _assets/ copy, de-colliding the basename. Idempotent per source.
function registerAsset(state: AssetPlanState, sourcePath: string): string {
  const existing = state.bySource.get(sourcePath);
  if (existing) return existing;
  const [stem, ext] = splitExt(basename(sourcePath));
  let name = `${stem}${ext}`;
  for (let n = 2; state.usedNames.has(name); n++) name = `${stem} (${n})${ext}`;
  state.usedNames.add(name);
  const target = `_assets/${name}`;
  state.assets.push({ sourcePath, targetName: target });
  state.bySource.set(sourcePath, target);
  return target;
}
```

Then replace the `return { ... }` block in `buildConsolidatePlan` with asset-aware logic. Insert **before** the return, after `chapters` and `bookNoteBody` are built:

```ts
  const assetState: AssetPlanState = { assets: [], bySource: new Map(), usedNames: new Set() };
  let coverRewrite: string | null = null;

  if (input.assetMode !== "none" && input.coverPath) {
    const target = registerAsset(assetState, input.coverPath);
    coverRewrite = `[[${target}]]`;
  }

  if (input.assetMode === "full") {
    present.forEach((c, i) => {
      for (const ref of c.imageRefs) {
        if (!ref.resolvedPath) continue;
        const target = registerAsset(assetState, ref.resolvedPath);
        chapters[i].rewrites.push({ from: ref.raw, to: target });
      }
    });
  }
```

And update the return object:

```ts
  return {
    folderName,
    bookNoteName: `${folderName}.md`,
    bookNoteBody,
    chapters,
    assets: assetState.assets,
    coverRewrite,
    skipped,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/consolidate-plan.test.ts`
Expected: PASS (all Task 1 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/consolidate-plan.ts tests/consolidate-plan.test.ts
git commit -m "feat(core): asset planning + cover/chapter rewrites in consolidate planner"
```

---

## Task 4: Pure import planner

**Files:**
- Create: `src/core/import-plan.ts`
- Test: `tests/import-plan.test.ts`

**Interfaces:**
- Consumes: `BOOK_FRONTMATTER_TEMPLATE` from `./frontmatter`, `sortFolderChapters` from `./spine-parser`.
- Produces:
```ts
export interface ImportPlan {
  bookNoteName: string;                 // "<folderName>.md"
  frontmatter: Record<string, unknown>; // scaffold; title = folderName, language = defaultLanguage
  body: string;                          // sorted embed spine
}
export function buildImportPlan(
  folderName: string,
  mdFilenames: string[],   // basenames without .md, any order
  defaultLanguage: string
): ImportPlan;
```
The folder note itself must be excluded from the spine if present (a `<folderName>` entry). Embeds use `![[basename]]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/import-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildImportPlan } from "../src/core/import-plan";

describe("buildImportPlan", () => {
  it("names the folder note after the folder", () => {
    const p = buildImportPlan("My Book", ["01 Intro", "02 Body"], "en");
    expect(p.bookNoteName).toBe("My Book.md");
  });

  it("scaffolds frontmatter with title = folder name and given language", () => {
    const p = buildImportPlan("My Book", ["a"], "de");
    expect(p.frontmatter.epub).toBe(true);
    expect(p.frontmatter.title).toBe("My Book");
    expect(p.frontmatter.language).toBe("de");
    expect(p.frontmatter.author).toBe("");
  });

  it("builds a numeric-aware sorted embed spine", () => {
    const p = buildImportPlan("B", ["10 Ten", "2 Two", "1 One"], "en");
    expect(p.body).toBe("![[1 One]]\n![[2 Two]]\n![[10 Ten]]");
  });

  it("excludes an existing folder note from the spine", () => {
    const p = buildImportPlan("My Book", ["My Book", "01 Intro"], "en");
    expect(p.body).toBe("![[01 Intro]]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/import-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/import-plan.ts
import { BOOK_FRONTMATTER_TEMPLATE } from "./frontmatter";
import { sortFolderChapters } from "./spine-parser";

export interface ImportPlan {
  bookNoteName: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function buildImportPlan(
  folderName: string,
  mdFilenames: string[],
  defaultLanguage: string
): ImportPlan {
  const chapters = sortFolderChapters(mdFilenames.filter((n) => n !== folderName));
  const body = chapters.map((n) => `![[${n}]]`).join("\n");

  const frontmatter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(BOOK_FRONTMATTER_TEMPLATE)) {
    frontmatter[k] = Array.isArray(v) ? [...(v as unknown[])] : v;
  }
  frontmatter.title = folderName;
  frontmatter.language = defaultLanguage;

  return { bookNoteName: `${folderName}.md`, frontmatter, body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/import-plan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/import-plan.ts tests/import-plan.test.ts
git commit -m "feat(core): pure import planner (folder -> book note)"
```

---

## Task 5: Settings + settings-tab + i18n for the two modes

**Files:**
- Modify: `src/obsidian/settings.ts`
- Modify: `src/obsidian/settings-tab.ts:15-56` (getSettingDefinitions) and `:72-127` (display)
- Modify: `src/i18n/strings.ts`
- Test: `tests/settings.test.ts` (create if absent — a small coerce test)

**Interfaces:**
- Consumes: `mergeSettings` (already used).
- Produces: `EpubExporterSettings` gains `consolidateChapterMode: ChapterMode` and `consolidateAssetMode: AssetMode`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings.test.ts
import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS } from "../src/obsidian/settings";

describe("consolidate settings defaults", () => {
  it("defaults chapter mode to copy and asset mode to full", () => {
    expect(DEFAULT_SETTINGS.consolidateChapterMode).toBe("copy");
    expect(DEFAULT_SETTINGS.consolidateAssetMode).toBe("full");
  });

  it("preserves a persisted consolidate choice", () => {
    const s = coerceSettings({ consolidateChapterMode: "move", consolidateAssetMode: "cover" });
    expect(s.consolidateChapterMode).toBe("move");
    expect(s.consolidateAssetMode).toBe("cover");
  });

  it("fills defaults when absent from persisted data", () => {
    const s = coerceSettings({ outputDestination: "share" });
    expect(s.consolidateChapterMode).toBe("copy");
    expect(s.consolidateAssetMode).toBe("full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/obsidian/settings.ts`, import the mode types and extend the interface + defaults:

```ts
import { mergeSettings } from "../vendor/kit/settings";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";

export type OutputDestination =
  | "besideNote" | "attachmentFolder" | "customFolder" | "share";

export interface EpubExporterSettings {
  outputDestination: OutputDestination;
  customFolder: string;
  openSidebarOnStartup: boolean;
  defaultLanguage: string;
  consolidateChapterMode: ChapterMode;
  consolidateAssetMode: AssetMode;
}

export const DEFAULT_SETTINGS: EpubExporterSettings = {
  outputDestination: "besideNote",
  customFolder: "",
  openSidebarOnStartup: false,
  defaultLanguage: "en",
  consolidateChapterMode: "copy",
  consolidateAssetMode: "full",
};

export function coerceSettings(raw: unknown): EpubExporterSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
```

Add i18n keys to **both** `EN` and `DE` in `src/i18n/strings.ts`:

```ts
// EN
"settings.consolidateChapter.name": "Consolidate: chapter files",
"settings.consolidateChapter.desc": "Whether Consolidate to folder copies or moves the chapter notes.",
"settings.consolidateChapter.copy": "Copy (keep originals)",
"settings.consolidateChapter.move": "Move (originals relocate)",
"settings.consolidateAsset.name": "Consolidate: images",
"settings.consolidateAsset.desc": "How many images to copy into the folder’s _assets subfolder.",
"settings.consolidateAsset.full": "Full — cover + all chapter images",
"settings.consolidateAsset.cover": "Cover only",
"settings.consolidateAsset.none": "None",
```

```ts
// DE
"settings.consolidateChapter.name": "Konsolidieren: Kapiteldateien",
"settings.consolidateChapter.desc": "Ob „In Ordner konsolidieren“ die Kapitelnotizen kopiert oder verschiebt.",
"settings.consolidateChapter.copy": "Kopieren (Originale bleiben)",
"settings.consolidateChapter.move": "Verschieben (Originale ziehen um)",
"settings.consolidateAsset.name": "Konsolidieren: Bilder",
"settings.consolidateAsset.desc": "Wie viele Bilder in den _assets-Unterordner kopiert werden.",
"settings.consolidateAsset.full": "Vollständig — Cover + alle Kapitelbilder",
"settings.consolidateAsset.cover": "Nur Cover",
"settings.consolidateAsset.none": "Keine",
```

In `settings-tab.ts`, append two entries to the `getSettingDefinitions()` array (after the openSidebar entry):

```ts
      {
        name: t("settings.consolidateChapter.name"),
        desc: t("settings.consolidateChapter.desc"),
        control: {
          type: "dropdown",
          key: "consolidateChapterMode",
          options: {
            copy: t("settings.consolidateChapter.copy"),
            move: t("settings.consolidateChapter.move"),
          },
        },
      },
      {
        name: t("settings.consolidateAsset.name"),
        desc: t("settings.consolidateAsset.desc"),
        control: {
          type: "dropdown",
          key: "consolidateAssetMode",
          options: {
            full: t("settings.consolidateAsset.full"),
            cover: t("settings.consolidateAsset.cover"),
            none: t("settings.consolidateAsset.none"),
          },
        },
      },
```

And mirror them in `display()` (append after the openSidebar toggle):

```ts
    new Setting(containerEl)
      .setName(t("settings.consolidateChapter.name"))
      .setDesc(t("settings.consolidateChapter.desc"))
      .addDropdown((d) => d
        .addOptions({
          copy: t("settings.consolidateChapter.copy"),
          move: t("settings.consolidateChapter.move"),
        })
        .setValue(s.consolidateChapterMode)
        .onChange(async (v) => { s.consolidateChapterMode = v as ChapterMode; await save(); }));

    new Setting(containerEl)
      .setName(t("settings.consolidateAsset.name"))
      .setDesc(t("settings.consolidateAsset.desc"))
      .addDropdown((d) => d
        .addOptions({
          full: t("settings.consolidateAsset.full"),
          cover: t("settings.consolidateAsset.cover"),
          none: t("settings.consolidateAsset.none"),
        })
        .setValue(s.consolidateAssetMode)
        .onChange(async (v) => { s.consolidateAssetMode = v as AssetMode; await save(); }));
```

Add the import at the top of `settings-tab.ts`:
```ts
import { ChapterMode, AssetMode } from "../core/consolidate-plan";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts tests/i18n*.test.ts`
Expected: PASS — coerce tests green, i18n parity intact (both languages have the new keys).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/settings.ts src/obsidian/settings-tab.ts src/i18n/strings.ts tests/settings.test.ts
git commit -m "feat(settings): consolidate chapter/asset mode settings + i18n"
```

---

## Task 6: Consolidate executor against a fake port

**Files:**
- Create: `src/obsidian/consolidate.ts` (port interface + executor only; gather + real port come in Task 7)
- Test: `tests/consolidate-exec.test.ts`

**Interfaces:**
- Consumes: `ConsolidatePlan`, `ChapterMode` (Task 1), `rewriteImageRefs` (Task 2).
- Produces:
```ts
export interface ConsolidatePort {
  createFolder(path: string): Promise<void>;
  readBody(path: string): Promise<string>;                 // chapter markdown, full file content
  copyFile(sourcePath: string, targetPath: string): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>; // create-or-overwrite
  copyBinary(sourcePath: string, targetPath: string): Promise<void>;
}
export interface ConsolidateContext {
  mode: ChapterMode;
  bookNoteSourcePath: string;   // the original book note's vault path
  bookNoteFrontmatter: string;  // the raw "---\n...\n---" block (may be "")
}
export interface ConsolidateResult { folderPath: string; chapterCount: number; assetCount: number; errors: string[]; }
export function executeConsolidatePlan(port: ConsolidatePort, plan: ConsolidatePlan, ctx: ConsolidateContext): Promise<ConsolidateResult>;
```

Execution order (all paths prefixed with `plan.folderName/`, itself created under the book note's parent by the real port in Task 7 — here paths are relative to the vault root of the fake, which is fine for testing order/behaviour):
1. `createFolder(folderName)` then `createFolder(folderName + "/_assets")` if assets exist.
2. For each chapter: `copyFile` (copy mode) or `moveFile` (move mode) source → `folderName/targetName`. Then if `rewrites.length`, `readBody(newPath)`, `rewriteImageRefs`, `writeFile(newPath, rewritten)`.
3. For each asset: `copyBinary(sourcePath, folderName + "/" + targetName)`. Assets always copy.
4. Book note: `writeFile(folderName/bookNoteName, frontmatter + "\n" + plan.bookNoteBody)`, applying `coverRewrite` to the frontmatter block first. In move mode, additionally `moveFile(bookNoteSourcePath, folderName/bookNoteName)` is **not** used — we always author the folder note fresh via `writeFile` and, in move mode, the original is removed by the port's `moveFile` of its content? No: keep it simple — always `writeFile` the folder note; in move mode delete the original via `moveFile(bookNoteSourcePath, folderName/bookNoteName)` BEFORE writing, so links update, then overwrite. To avoid double-handling, the executor: move mode → `moveFile(book, target)` then `writeFile(target, ...)`; copy mode → `writeFile(target, ...)` only.
5. Collect any thrown step into `errors` (settle, don't abort).

- [ ] **Step 1: Write the failing test**

```ts
// tests/consolidate-exec.test.ts
import { describe, it, expect } from "vitest";
import { executeConsolidatePlan, ConsolidatePort, ConsolidateContext } from "../src/obsidian/consolidate";
import { ConsolidatePlan } from "../src/core/consolidate-plan";

class FakePort implements ConsolidatePort {
  folders: string[] = [];
  files = new Map<string, string>();     // text files
  binaries: Array<[string, string]> = []; // [source, target]
  moves: Array<[string, string]> = [];
  copies: Array<[string, string]> = [];
  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }
  async createFolder(p: string) { this.folders.push(p); }
  async readBody(p: string) { return this.files.get(p) ?? ""; }
  async copyFile(s: string, t: string) { this.copies.push([s, t]); this.files.set(t, this.files.get(s) ?? ""); }
  async moveFile(s: string, t: string) { this.moves.push([s, t]); this.files.set(t, this.files.get(s) ?? ""); this.files.delete(s); }
  async writeFile(p: string, c: string) { this.files.set(p, c); }
  async copyBinary(s: string, t: string) { this.binaries.push([s, t]); }
}

function plan(over: Partial<ConsolidatePlan> = {}): ConsolidatePlan {
  return {
    folderName: "Book",
    bookNoteName: "Book.md",
    bookNoteBody: "![[01 - A]]",
    chapters: [{ sourcePath: "notes/A.md", targetName: "01 - A.md", rewrites: [] }],
    assets: [],
    coverRewrite: null,
    skipped: 0,
    ...over,
  };
}
const ctx = (over: Partial<ConsolidateContext> = {}): ConsolidateContext => ({
  mode: "copy", bookNoteSourcePath: "src/Book.md", bookNoteFrontmatter: "---\nepub: true\n---", ...over,
});

describe("executeConsolidatePlan", () => {
  it("copy mode creates folder, copies chapters, writes the folder note", async () => {
    const port = new FakePort({ "notes/A.md": "chapter body" });
    const res = await executeConsolidatePlan(port, plan(), ctx());
    expect(port.folders).toContain("Book");
    expect(port.copies).toContainEqual(["notes/A.md", "Book/01 - A.md"]);
    expect(port.files.get("Book/Book.md")).toBe("---\nepub: true\n---\n![[01 - A]]");
    expect(port.moves).toHaveLength(0);
    expect(res.chapterCount).toBe(1);
  });

  it("move mode relocates chapters and the book note", async () => {
    const port = new FakePort({ "notes/A.md": "x", "src/Book.md": "---\nepub: true\n---\nold" });
    await executeConsolidatePlan(port, plan(), ctx({ mode: "move" }));
    expect(port.moves).toContainEqual(["notes/A.md", "Book/01 - A.md"]);
    expect(port.moves).toContainEqual(["src/Book.md", "Book/Book.md"]);
    expect(port.files.get("Book/Book.md")).toBe("---\nepub: true\n---\n![[01 - A]]");
  });

  it("rewrites chapter image refs after copying", async () => {
    const port = new FakePort({ "notes/A.md": "![[pic.png]]" });
    await executeConsolidatePlan(
      port,
      plan({
        chapters: [{ sourcePath: "notes/A.md", targetName: "01 - A.md", rewrites: [{ from: "pic.png", to: "_assets/pic.png" }] }],
        assets: [{ sourcePath: "media/pic.png", targetName: "_assets/pic.png" }],
      }),
      ctx()
    );
    expect(port.files.get("Book/01 - A.md")).toBe("![[_assets/pic.png]]");
    expect(port.binaries).toContainEqual(["media/pic.png", "Book/_assets/pic.png"]);
    expect(port.folders).toContain("Book/_assets");
  });

  it("applies coverRewrite to the folder-note frontmatter", async () => {
    const port = new FakePort({ "notes/A.md": "x" });
    await executeConsolidatePlan(
      port,
      plan({ coverRewrite: "[[_assets/cover.png]]" }),
      ctx({ bookNoteFrontmatter: "---\nepub: true\ncover: \"[[cover.png]]\"\n---" })
    );
    expect(port.files.get("Book/Book.md")).toContain("cover: \"[[_assets/cover.png]]\"");
  });

  it("settles chapter errors into the result instead of aborting", async () => {
    const port = new FakePort();
    port.copyFile = async () => { throw new Error("boom"); };
    const res = await executeConsolidatePlan(port, plan(), ctx());
    expect(res.errors.length).toBe(1);
    expect(port.files.has("Book/Book.md")).toBe(true); // still wrote the folder note
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/consolidate-exec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/obsidian/consolidate.ts
import { ConsolidatePlan, ChapterMode } from "../core/consolidate-plan";
import { rewriteImageRefs } from "../core/image-refs";

export interface ConsolidatePort {
  createFolder(path: string): Promise<void>;
  readBody(path: string): Promise<string>;
  copyFile(sourcePath: string, targetPath: string): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  copyBinary(sourcePath: string, targetPath: string): Promise<void>;
}

export interface ConsolidateContext {
  mode: ChapterMode;
  bookNoteSourcePath: string;
  bookNoteFrontmatter: string;
}

export interface ConsolidateResult {
  folderPath: string;
  chapterCount: number;
  assetCount: number;
  errors: string[];
}

// Rewrite the cover value inside a raw frontmatter block. Matches `cover:` (or its
// German alias `titelbild:`) and replaces the rest of the line with a quoted wikilink.
function applyCoverRewrite(fm: string, cover: string | null): string {
  if (!cover) return fm;
  const line = new RegExp(`^(\\s*(?:cover|titelbild)\\s*:).*$`, "mi");
  if (line.test(fm)) return fm.replace(line, `$1 "${cover}"`);
  // No cover key present: inject one before the closing fence.
  return fm.replace(/\n---\s*$/, `\ncover: "${cover}"\n---`);
}

export async function executeConsolidatePlan(
  port: ConsolidatePort,
  plan: ConsolidatePlan,
  ctx: ConsolidateContext
): Promise<ConsolidateResult> {
  const errors: string[] = [];
  const folder = plan.folderName;
  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  await run("create folder", () => port.createFolder(folder));
  if (plan.assets.length) await run("create _assets", () => port.createFolder(`${folder}/_assets`));

  let chapterCount = 0;
  for (const ch of plan.chapters) {
    const target = `${folder}/${ch.targetName}`;
    await run(`chapter ${ch.targetName}`, async () => {
      if (ctx.mode === "move") await port.moveFile(ch.sourcePath, target);
      else await port.copyFile(ch.sourcePath, target);
      if (ch.rewrites.length) {
        const body = await port.readBody(target);
        await port.writeFile(target, rewriteImageRefs(body, ch.rewrites));
      }
      chapterCount++;
    });
  }

  let assetCount = 0;
  for (const a of plan.assets) {
    await run(`asset ${a.targetName}`, async () => {
      await port.copyBinary(a.sourcePath, `${folder}/${a.targetName}`);
      assetCount++;
    });
  }

  await run("folder note", async () => {
    const fm = applyCoverRewrite(ctx.bookNoteFrontmatter, plan.coverRewrite);
    const content = fm ? `${fm}\n${plan.bookNoteBody}` : plan.bookNoteBody;
    const target = `${folder}/${plan.bookNoteName}`;
    if (ctx.mode === "move") await port.moveFile(ctx.bookNoteSourcePath, target);
    await port.writeFile(target, content);
  });

  return { folderPath: folder, chapterCount, assetCount, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/consolidate-exec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/consolidate.ts tests/consolidate-exec.test.ts
git commit -m "feat(obsidian): consolidate executor (copy/move/assets/rewrite) via port"
```

---

## Task 7: Real ports + gather (Obsidian edges)

**Files:**
- Modify: `src/obsidian/consolidate.ts` (add `createConsolidatePort`, `gatherConsolidateInput`)
- Create: `src/obsidian/import.ts` (`createImportPort`, `executeImport`)
- Test: `tests/import-exec.test.ts`

**Interfaces:**
- Consumes: Obsidian `App`, `TFile`, `TFolder`, `normalizePath`; `buildImportPlan` (Task 4); `ConsolidateInput`/`AssetMode` (Task 1); `extractImageRefs` (Task 2); `parseEmbedSpine` (spine-parser); `parseBookMetadata`, `isBookNote`, `stripFrontmatter` (frontmatter).
- Produces: real port implementations + gather. `gatherConsolidateInput` returns `{ input: ConsolidateInput; frontmatterBlock: string; bookNoteSourcePath: string }`.

These are the thin Obsidian edges — only `executeImport`'s planner path is unit-tested (via a fake import port); the Obsidian-touching `createConsolidatePort`, `createImportPort`, and `gatherConsolidateInput` are verified by GUI smoke (Task 10).

- [ ] **Step 1: Write the failing test (import executor via fake port)**

```ts
// tests/import-exec.test.ts
import { describe, it, expect } from "vitest";
import { executeImport, ImportPort } from "../src/obsidian/import";
import { buildImportPlan } from "../src/core/import-plan";

class FakeImportPort implements ImportPort {
  created = new Map<string, string>();
  existing: Set<string>;
  constructor(existing: string[] = []) { this.existing = new Set(existing); }
  async exists(path: string) { return this.existing.has(path); }
  async createNote(path: string, content: string) { this.created.set(path, content); }
}

describe("executeImport", () => {
  it("creates the folder note with frontmatter + spine", async () => {
    const port = new FakeImportPort();
    const plan = buildImportPlan("My Book", ["01 Intro", "02 Body"], "en");
    const res = await executeImport(port, "folder/My Book", plan);
    expect(res.created).toBe(true);
    const content = port.created.get("folder/My Book/My Book.md")!;
    expect(content).toContain("epub: true");
    expect(content).toContain("![[01 Intro]]");
    expect(content).toContain("![[02 Body]]");
  });

  it("refuses to overwrite an existing folder note", async () => {
    const port = new FakeImportPort(["folder/My Book/My Book.md"]);
    const plan = buildImportPlan("My Book", ["a"], "en");
    const res = await executeImport(port, "folder/My Book", plan);
    expect(res.created).toBe(false);
    expect(port.created.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/import-exec.test.ts`
Expected: FAIL — `src/obsidian/import.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/obsidian/import.ts`:

```ts
// src/obsidian/import.ts
import { App, TFile, TFolder, stringifyYaml } from "obsidian";
import { ImportPlan } from "../core/import-plan";

export interface ImportPort {
  exists(path: string): Promise<boolean>;
  createNote(path: string, content: string): Promise<void>;
}

export function createImportPort(app: App): ImportPort {
  return {
    async exists(path) {
      return app.vault.getAbstractFileByPath(path) !== null;
    },
    async createNote(path, content) {
      await app.vault.create(path, content);
    },
  };
}

// List the .md basenames directly inside a folder (for buildImportPlan).
export function folderMdBasenames(app: App, folderPath: string): string[] {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
    .map((f) => f.basename);
}

export interface ImportResult { created: boolean; notePath: string; }

export async function executeImport(
  port: ImportPort,
  folderPath: string,
  plan: ImportPlan
): Promise<ImportResult> {
  const notePath = `${folderPath}/${plan.bookNoteName}`;
  if (await port.exists(notePath)) return { created: false, notePath };
  const yaml = stringifyYaml(plan.frontmatter).trimEnd();
  const content = `---\n${yaml}\n---\n\n${plan.body}\n`;
  await port.createNote(notePath, content);
  return { created: true, notePath };
}
```

Then add the real consolidate port + gather to `src/obsidian/consolidate.ts`:

```ts
// appended to src/obsidian/consolidate.ts
import { App, TFile, TFolder, normalizePath } from "obsidian";
import { ConsolidateInput, AssetMode, ResolvedImageRef } from "../core/consolidate-plan";
import { extractImageRefs } from "../core/image-refs";
import { parseEmbedSpine } from "../core/spine-parser";
import { parseBookMetadata, isBookNote, stripFrontmatter } from "../core/frontmatter";

export function createConsolidatePort(app: App): ConsolidatePort {
  const a = app.vault.adapter;
  return {
    async createFolder(path) {
      if (!(await a.exists(normalizePath(path)))) await app.vault.createFolder(normalizePath(path));
    },
    async readBody(path) {
      const f = app.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? app.vault.read(f) : "";
    },
    async copyFile(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) await app.vault.copy(f, targetPath);
    },
    async moveFile(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) await app.fileManager.renameFile(f, targetPath);
    },
    async writeFile(path, content) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await app.vault.modify(f, content);
      else await app.vault.create(path, content);
    },
    async copyBinary(sourcePath, targetPath) {
      const f = app.vault.getAbstractFileByPath(sourcePath);
      if (f instanceof TFile) {
        const bytes = await app.vault.readBinary(f);
        await a.writeBinary(normalizePath(targetPath), bytes);
      }
    },
  };
}

export interface GatheredConsolidate {
  input: ConsolidateInput;
  parentDir: string;         // dir the folder is created in ("" = vault root)
  frontmatterBlock: string;
  bookNoteSourcePath: string;
}

// Read a book note and resolve everything the pure planner needs. Obsidian-only edge.
export async function gatherConsolidateInput(
  app: App,
  bookFile: TFile,
  assetMode: AssetMode,
  defaultLanguage: string
): Promise<GatheredConsolidate> {
  const content = await app.vault.read(bookFile);
  const fm = (app.metadataCache.getFileCache(bookFile)?.frontmatter ?? {}) as Record<string, unknown>;
  const body = stripFrontmatter(content);
  const frontmatterBlock = content.slice(0, content.length - body.length).trimEnd();

  const spine = parseEmbedSpine(body);
  const leadingProse = body
    .split(/\r?\n/)
    .filter((line) => !/^!\[\[[^\]]+\]\]$/.test(line.trim()))
    .join("\n")
    .trim();

  const chapters = spine.map((entry) => {
    const dest = app.metadataCache.getFirstLinkpathDest(entry.target, bookFile.path);
    if (!(dest instanceof TFile) || dest.extension !== "md") {
      return { sourcePath: null, title: entry.target, imageRefs: [] };
    }
    const dfm = (app.metadataCache.getFileCache(dest)?.frontmatter ?? {}) as Record<string, unknown>;
    const ct = dfm["chapter_title"];
    const title = typeof ct === "string" && ct ? ct : dest.basename;
    let imageRefs: ResolvedImageRef[] = [];
    if (assetMode === "full") {
      imageRefs = []; // filled below after we can read the body
    }
    return { sourcePath: dest.path, title, imageRefs, _dest: dest };
  });

  // For full mode, read each present chapter body and resolve image refs.
  if (assetMode === "full") {
    for (const c of chapters as Array<{ sourcePath: string | null; imageRefs: ResolvedImageRef[]; _dest?: TFile }>) {
      if (!c.sourcePath || !c._dest) continue;
      const cbody = stripFrontmatter(await app.vault.read(c._dest));
      c.imageRefs = extractImageRefs(cbody).map((raw) => {
        const dest = app.metadataCache.getFirstLinkpathDest(raw, c.sourcePath as string);
        return { raw, resolvedPath: dest instanceof TFile ? dest.path : null };
      });
    }
  }

  // Cover: resolve the frontmatter cover value to a vault path.
  let coverPath: string | null = null;
  if (assetMode !== "none") {
    const meta = parseBookMetadata(fm, { fallbackTitle: bookFile.basename, defaultLanguage });
    if (meta.coverImagePath) {
      const inner = meta.coverImagePath.replace(/!?\[\[([^\]]+)\]\]/, "$1").split("|")[0].split("#")[0].trim();
      const dest = app.metadataCache.getFirstLinkpathDest(inner, bookFile.path);
      coverPath = dest instanceof TFile ? dest.path : null;
    }
  }

  const parent = bookFile.parent && bookFile.parent.path !== "/" ? bookFile.parent.path : "";
  const siblings = bookFile.parent instanceof TFolder
    ? bookFile.parent.children.filter((c) => c instanceof TFolder).map((c) => (c as TFolder).name)
    : [];

  const bookTitle = parseBookMetadata(fm, { fallbackTitle: bookFile.basename, defaultLanguage }).title;

  const input: ConsolidateInput = {
    bookTitle,
    chapters: chapters.map((c) => ({ sourcePath: c.sourcePath, title: c.title, imageRefs: c.imageRefs })),
    leadingProse,
    coverPath,
    assetMode,
    existingFolderNames: siblings,
  };
  return { input, parentDir: parent, frontmatterBlock, bookNoteSourcePath: bookFile.path };
}
```

> **Note on paths:** `buildConsolidatePlan` returns a bare `folderName`. The executor prefixes chapter/asset/book-note targets with `folderName/`. The **parent directory** is applied in `main.ts` (Task 10) by passing a port whose paths are rooted at `parentDir` — see Task 10 for how `parentDir` is prepended. Keep `folderName` parent-free here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/import-exec.test.ts && npm run check:pure`
Expected: PASS (2 tests); check:pure stays green (core untouched by obsidian imports).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/consolidate.ts src/obsidian/import.ts tests/import-exec.test.ts
git commit -m "feat(obsidian): real consolidate/import ports + gather-from-vault"
```

---

## Task 8: Consolidate confirmation modal

**Files:**
- Create: `src/obsidian/consolidate-modal.ts`
- Modify: `src/i18n/strings.ts` (modal keys)
- (No node test — Obsidian `Modal` UI; verified in GUI smoke.)

**Interfaces:**
- Consumes: Obsidian `App`, `Modal`, `Setting`; `ChapterMode`, `AssetMode`.
- Produces:
```ts
export interface ConsolidatePreview {
  folderName: string; chapterCount: number; assetCount: number;
  collision: boolean; defaultChapterMode: ChapterMode; defaultAssetMode: AssetMode;
}
export class ConsolidateModal extends Modal {
  constructor(app: App, preview: ConsolidatePreview, onConfirm: (mode: ChapterMode, assets: AssetMode) => void);
}
```

- [ ] **Step 1: Add i18n keys (EN + DE)**

```ts
// EN
"modal.consolidate.title": "Consolidate to folder",
"modal.consolidate.summary": "Folder “{0}” · {1} chapter(s) · {2} image(s)",
"modal.consolidate.collision": "A folder named “{0}” already exists — a numbered suffix will be used.",
"modal.consolidate.confirm": "Consolidate",
"modal.consolidate.cancel": "Cancel",
"notice.consolidated": "Consolidated to {0}.",
"notice.consolidateErrors": "Consolidated with {0} problem(s) — see console.",
"notice.notBookNote": "This note is not a book note (add book frontmatter first).",
"notice.imported": "Created book note {0}.",
"notice.importExists": "A book note already exists in that folder.",
"notice.importEmpty": "That folder has no notes to import.",
"cmd.consolidate": "Consolidate book to folder",
```

```ts
// DE
"modal.consolidate.title": "In Ordner konsolidieren",
"modal.consolidate.summary": "Ordner „{0}“ · {1} Kapitel · {2} Bild(er)",
"modal.consolidate.collision": "Ein Ordner „{0}“ existiert bereits — es wird ein nummeriertes Suffix verwendet.",
"modal.consolidate.confirm": "Konsolidieren",
"modal.consolidate.cancel": "Abbrechen",
"notice.consolidated": "Konsolidiert nach {0}.",
"notice.consolidateErrors": "Konsolidiert mit {0} Problem(en) — siehe Konsole.",
"notice.notBookNote": "Diese Notiz ist keine Buch-Notiz (zuerst Buch-Frontmatter ergänzen).",
"notice.imported": "Buch-Notiz {0} erstellt.",
"notice.importExists": "In diesem Ordner existiert bereits eine Buch-Notiz.",
"notice.importEmpty": "Dieser Ordner enthält keine Notizen zum Importieren.",
"cmd.consolidate": "Buch in Ordner konsolidieren",
```

- [ ] **Step 2: Write the modal**

```ts
// src/obsidian/consolidate-modal.ts
import { App, Modal, Setting } from "obsidian";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";
import { t } from "../vendor/kit/i18n";

export interface ConsolidatePreview {
  folderName: string;
  chapterCount: number;
  assetCount: number;
  collision: boolean;
  defaultChapterMode: ChapterMode;
  defaultAssetMode: AssetMode;
}

export class ConsolidateModal extends Modal {
  private chapterMode: ChapterMode;
  private assetMode: AssetMode;

  constructor(
    app: App,
    private preview: ConsolidatePreview,
    private onConfirm: (mode: ChapterMode, assets: AssetMode) => void
  ) {
    super(app);
    this.chapterMode = preview.defaultChapterMode;
    this.assetMode = preview.defaultAssetMode;
  }

  onOpen(): void {
    const { contentEl, preview } = this;
    contentEl.addClass("epub-consolidate-modal");
    contentEl.createEl("h3", { text: t("modal.consolidate.title") });
    contentEl.createEl("p", {
      cls: "epub-consolidate-summary",
      text: t("modal.consolidate.summary", preview.folderName, preview.chapterCount, preview.assetCount),
    });
    if (preview.collision) {
      contentEl.createEl("p", {
        cls: "epub-consolidate-warning",
        text: t("modal.consolidate.collision", preview.folderName),
      });
    }

    new Setting(contentEl)
      .setName(t("settings.consolidateChapter.name"))
      .addDropdown((d) => d
        .addOptions({
          copy: t("settings.consolidateChapter.copy"),
          move: t("settings.consolidateChapter.move"),
        })
        .setValue(this.chapterMode)
        .onChange((v) => { this.chapterMode = v as ChapterMode; }));

    new Setting(contentEl)
      .setName(t("settings.consolidateAsset.name"))
      .addDropdown((d) => d
        .addOptions({
          full: t("settings.consolidateAsset.full"),
          cover: t("settings.consolidateAsset.cover"),
          none: t("settings.consolidateAsset.none"),
        })
        .setValue(this.assetMode)
        .onChange((v) => { this.assetMode = v as AssetMode; }));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("modal.consolidate.cancel")).onClick(() => this.close()))
      .addButton((b) => b
        .setButtonText(t("modal.consolidate.confirm"))
        .setCta()
        .onClick(() => { this.close(); this.onConfirm(this.chapterMode, this.assetMode); }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 3: Verify it compiles & lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no obsidian-namespaced lint errors; modal uses only public APIs).

- [ ] **Step 4: Commit**

```bash
git add src/obsidian/consolidate-modal.ts src/i18n/strings.ts
git commit -m "feat(obsidian): consolidate confirmation modal + i18n"
```

---

## Task 9: Sidebar consolidate button

**Files:**
- Modify: `src/obsidian/sidebar-render.ts:5-8` (handlers) and the book-context block (`:34-59`)
- Test: `tests/sidebar-render.test.ts` (add a case — reuse the existing suite's setup)

**Interfaces:**
- Consumes: `SidebarModel` (unchanged).
- Produces: `SidebarHandlers` gains `onConsolidate(): void`. A `[Consolidate to folder]` button renders in the book context.

- [ ] **Step 1: Write the failing test**

Add to `tests/sidebar-render.test.ts` (mirror the file's existing imports/helpers):

```ts
it("renders a consolidate button in the book context and wires the handler", () => {
  const root = makeFakeEl();
  let consolidated = 0;
  const model = { context: "book" as const, title: "B", chapters: [], missingCount: 0 };
  renderSidebar(root as unknown as HTMLElement, model, {
    onExport() {}, onInsertFrontmatter() {}, onConsolidate() { consolidated++; },
  });
  const btn = root.find("epub-sb-action-consolidate");
  expect(btn).not.toBeNull();
  btn!.click();
  expect(consolidated).toBe(1);
});
```

> If existing `renderSidebar` calls in this test file now fail to typecheck (missing `onConsolidate`), add `onConsolidate() {}` to each — the handler is required.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidebar-render.test.ts`
Expected: FAIL — no `epub-sb-action-consolidate` element / type error on handlers.

- [ ] **Step 3: Write minimal implementation**

In `sidebar-render.ts`, extend the handler interface:

```ts
export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
  onConsolidate(): void;
}
```

In the `if (model.context === "book")` block, after the `metaBtn` wiring and before `return;`:

```ts
    const consolidateBtn = root.createEl("button", {
      cls: "epub-sb-btn epub-sb-action-consolidate",
      text: t("view.consolidate"),
    });
    consolidateBtn.addEventListener("click", () => handlers.onConsolidate());
```

Add the i18n keys (EN + DE) to `strings.ts`:

```ts
"view.consolidate": "Consolidate to folder", // EN
"view.consolidate": "In Ordner konsolidieren", // DE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidebar-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/sidebar-render.ts src/i18n/strings.ts tests/sidebar-render.test.ts
git commit -m "feat(sidebar): consolidate-to-folder button in book context"
```

---

## Task 10: main.ts wiring + styles + full gate

**Files:**
- Modify: `src/main.ts`
- Modify: `styles.css`
- (Verified by full gate + GUI smoke.)

**Interfaces:**
- Consumes: everything above.
- Produces: Consolidate command + book-note/folder file-menu items + sidebar `onConsolidate` handler; Import folder file-menu item. A `parentDir`-aware port wraps `createConsolidatePort`.

- [ ] **Step 1: Add the consolidate flow to `main.ts`**

Add imports:

```ts
import { buildConsolidatePlan } from "./core/consolidate-plan";
import { createConsolidatePort, gatherConsolidateInput, executeConsolidatePlan, ConsolidatePort } from "./obsidian/consolidate";
import { createImportPort, folderMdBasenames, executeImport } from "./obsidian/import";
import { buildImportPlan } from "./core/import-plan";
import { ConsolidateModal } from "./obsidian/consolidate-modal";
import { isBookNote } from "./core/frontmatter";
```

Add a helper that prefixes every port path with the parent dir (so `folderName` stays parent-free in the planner):

```ts
  private rootedPort(base: ConsolidatePort, parentDir: string): ConsolidatePort {
    const at = (p: string) => (parentDir ? `${parentDir}/${p}` : p);
    return {
      createFolder: (p) => base.createFolder(at(p)),
      readBody: (p) => base.readBody(at(p)),
      copyFile: (s, t2) => base.copyFile(s, at(t2)),          // source is already an absolute vault path
      moveFile: (s, t2) => base.moveFile(s, at(t2)),
      writeFile: (p, c) => base.writeFile(at(p), c),
      copyBinary: (s, t2) => base.copyBinary(s, at(t2)),
    };
  }

  // Gather for preview only, then open the modal. The chosen asset mode from the
  // modal changes what needs gathering (image refs are only collected in full mode),
  // so runConsolidate re-gathers with the confirmed choice.
  private async consolidateBook(file: TFile): Promise<void> {
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    if (!isBookNote(fm)) { new Notice(t("notice.notBookNote")); return; }

    const assetMode = this.settings.consolidateAssetMode;
    const { input } = await gatherConsolidateInput(this.app, file, assetMode, this.settings.defaultLanguage);
    const plan = buildConsolidatePlan(input);

    const preview = {
      folderName: plan.folderName,
      chapterCount: plan.chapters.length,
      assetCount: plan.assets.length,
      // The planner suffixes on collision, so a changed folder name means a sibling existed.
      collision: plan.folderName !== sanitizeBase(input.bookTitle),
      defaultChapterMode: this.settings.consolidateChapterMode,
      defaultAssetMode: assetMode,
    };

    new ConsolidateModal(this.app, preview, (mode, assets) => {
      void this.runConsolidate(file, mode, assets);
    }).open();
  }

  private async runConsolidate(
    file: TFile,
    mode: "copy" | "move",
    assets: "full" | "cover" | "none"
  ): Promise<void> {
    try {
      const { input, parentDir, frontmatterBlock, bookNoteSourcePath } =
        await gatherConsolidateInput(this.app, file, assets, this.settings.defaultLanguage);
      const plan = buildConsolidatePlan(input);
      const port = this.rootedPort(createConsolidatePort(this.app), parentDir);
      const res = await executeConsolidatePlan(port, plan, {
        mode, bookNoteSourcePath, bookNoteFrontmatter: frontmatterBlock,
      });
      const full = parentDir ? `${parentDir}/${plan.folderName}` : plan.folderName;
      if (res.errors.length) {
        console.error("EPUB Exporter: consolidate problems", res.errors);
        new Notice(t("notice.consolidateErrors", res.errors.length));
      } else {
        new Notice(t("notice.consolidated", full));
      }
      if (plan.skipped > 0) new Notice(t("notice.brokenEmbed", plan.skipped));
    } catch (e) {
      console.error("EPUB Exporter: consolidate failed", e);
      new Notice(t("notice.exportFailed"));
    }
  }

  private async importFolder(folder: TFolder): Promise<void> {
    const basenames = folderMdBasenames(this.app, folder.path);
    if (basenames.length === 0) { new Notice(t("notice.importEmpty")); return; }
    const plan = buildImportPlan(folder.name, basenames, this.settings.defaultLanguage);
    const res = await executeImport(createImportPort(this.app), folder.path, plan);
    if (!res.created) { new Notice(t("notice.importExists")); return; }
    new Notice(t("notice.imported", res.notePath));
    const created = this.app.vault.getAbstractFileByPath(res.notePath);
    if (created instanceof TFile) void this.app.workspace.getLeaf(false).openFile(created);
  }
```

> Remove the unused `frontmatterBlock`/`bookNoteSourcePath` destructure in `consolidateBook` (they are re-gathered in `runConsolidate`) — keep `consolidateBook` limited to gather-for-preview + open modal. Simplify: in `consolidateBook`, destructure only `{ input }`.

- [ ] **Step 2: Register commands + menu items in `onload()`**

After the existing folder file-menu registration, extend it and add the command:

```ts
    this.addCommand({
      id: "consolidate-book",
      name: t("cmd.consolidate"),
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!f && f.extension === "md" &&
          isBookNote((this.app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>);
        if (ok && !checking) void this.consolidateBook(f as TFile);
        return ok;
      },
    });
```

Extend the `file-menu` handler to add: Import on a `TFolder`, Consolidate on a book-note `TFile`:

```ts
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.exportFolder")).setIcon("book").onClick(() => {
              void this.exportSource({ kind: "folder", path: file.path });
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("cmd.importFolder")).setIcon("book-plus").onClick(() => {
              void this.importFolder(file);
            })
          );
        }
        if (file instanceof TFile && file.extension === "md" &&
            isBookNote((this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>)) {
          menu.addItem((item) =>
            item.setTitle(t("cmd.consolidate")).setIcon("folder-input").onClick(() => {
              void this.consolidateBook(file);
            })
          );
        }
      })
    );
```

> The existing `file-menu` registration block is **replaced** by the one above (don't register the event twice). Add the `cmd.importFolder` i18n key (EN `"Import folder as book"`, DE `"Ordner als Buch importieren"`).

Wire the sidebar handler in `makeBridge()`:

```ts
        onConsolidate: () => {
          const f = resolveTargetFile(this.app);
          if (f) void this.consolidateBook(f);
          else new Notice(t("notice.noActiveNote"));
        },
```

- [ ] **Step 3: Add modal styles to `styles.css`**

```css
.epub-consolidate-modal .epub-consolidate-summary { color: var(--text-muted); }
.epub-consolidate-modal .epub-consolidate-warning { color: var(--text-warning); }
```

- [ ] **Step 4: Run the full gate**

Run: `npm run gate`
Expected: PASS — typecheck, all vitest suites, `check:pure`, lint (no inline disables, no obsidian-namespaced API violations), build.

> If lint flags `book-plus`/`folder-input` icons as unknown, swap to known Lucide ids (`copy-plus`, `folder`) — icon names are not lint-checked but must exist at runtime; verify in GUI smoke.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts styles.css src/i18n/strings.ts
git commit -m "feat: wire consolidate (command/menu/sidebar) + import (folder menu)"
```

---

## Task 11: GUI smoke handover + docs

**Files:**
- Modify: `CHANGELOG.md` (add `[Unreleased]` entries)
- (GUI verification via `/user-handover` — not code.)

- [ ] **Step 1: Deploy the fresh build to the test vault**

Copy `main.js` + `styles.css` (+ `manifest.json` if changed) into `<vault>/.obsidian/plugins/epub-exporter/`, then reload the plugin (toggle off/on). **Gotcha (LESSONS.md):** the vault plugin folder is a copy, not a symlink — a build does not reach the running plugin on its own. Verify with `grep -c consolidate <vault>/.obsidian/plugins/epub-exporter/main.js`.

- [ ] **Step 2: Build the GUI-smoke handover**

Produce a `/user-handover` checklist covering, on the test book in `[[_TEMP/_epub-testing]]`:
- Consolidate **copy** (full assets) → folder has `<Title>.md` + `NN - …md` + `_assets/`; originals untouched; the new book note renders live; re-export produces a valid EPUB.
- Consolidate **move** → chapters relocated, book note relocated, embeds intact, originals gone.
- Consolidate with a **name collision** → suffixed folder + collision warning shown in the modal.
- **Import** a plain folder → `<Folder>.md` created, spine in filename order, opens automatically, renders live.
- **Round-trip:** Consolidate (copy) → Import the resulting folder into a sibling → equivalent book.
- Broken-embed skip notice appears when a chapter link is dangling.

- [ ] **Step 3: Update CHANGELOG.md `[Unreleased]`**

```markdown
### Added
- **Consolidate to folder**: turn a book note into a self-contained folder (book note + numbered chapters + `_assets/`), with a confirmation modal (copy/move chapters · full/cover/none images) and matching settings defaults.
- **Import folder as book**: create a book note (folder note) from a folder of markdown files, with a filename-sorted embed spine (right-click a folder).
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): Phase 2 consolidate & import under [Unreleased]"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §2 layout → T1/T3/T6; §3 modal + copy/move → T8/T6/T10; §4 import (non-destructive, existing-note guard) → T4/T7; §5 assets (full/cover/none, dedup, rewrite) → T2/T3/T6/T7; §6 architecture (pure planners + ports) → T1–T7; §7 error handling (collision suffix, skipped embeds, settle-not-abort) → T1/T3/T6/T10; §8 tests → each task; §9 kit-reuse (`sanitizeBase`/`sortFolderChapters`/`BOOK_FRONTMATTER_TEMPLATE`/`parseEmbedSpine`) → T1/T4/T7.
- **Deviation (documented):** Import has no sidebar button (sidebar carries no folder context) — reachable via folder file-menu, mirroring folder-export. Consolidate is reachable via command + sidebar + book-note file-menu.
- **Leading prose** is kept in the book note (not extracted) — the export already turns it into the leading chapter (spec §2.3), consistent with `assembleBook`.
- **Type consistency:** `ChapterMode`/`AssetMode` are defined once in `consolidate-plan.ts` and imported by settings, modal, and main. `ConsolidatePort` shape is identical in Task 6 (fake) and Task 7 (real).
