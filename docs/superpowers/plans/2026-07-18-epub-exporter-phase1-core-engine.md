# EPUB Exporter — Phase 1, Plan 1: Core-Engine (pur) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine node-testbare, Obsidian-freie Bibliothek, die aus strukturierten Eingaben (Metadaten + Kapitel-XHTML + Bilder) valide EPUB3-Bytes erzeugt — plus die puren Parser (`frontmatter`, `spine-parser`, `dom-to-xhtml`), die später die Buch-Note in diese Struktur überführen.

**Architecture:** Alles in `src/core/` ist rein (keine `obsidian`-Imports, keine `node:`-APIs). Datenfluss: `frontmatter` (FM-Record → `BookMetadata`) · `spine-parser` (Buch-Note-Body → geordnete Embed-Liste) · `dom-to-xhtml` (gerenderter DOM + injizierte Resolver → XHTML-String) → das Ergebnis wird zu einem `Book` zusammengesetzt, den `epub-builder` über den store-only `zip-writer` zu `.epub`-Bytes serialisiert. Die Obsidian-Orchestrierung (Notes lesen, `MarkdownRenderer` aufrufen, Bild-Bytes/Cross-Links auflösen) kommt in Plan 2.

**Tech Stack:** TypeScript · esbuild (Bundle) · vitest (Tests) · `jsdom` (nur Test-DOM) · `fflate` (nur Test-Unzip zur Verifikation). **Keine Runtime-Dependencies.**

## Global Constraints

Gelten für **jede** Task (verbatim aus dem Spec):

- **Keine npm-Runtime-Dependencies.** `jsdom`/`fflate` sind ausschließlich `devDependencies` (Tests). Produktionscode nutzt nur Web-Standards (`TextEncoder`, `DataView`, `Uint8Array`).
- **Kein `node:`-Import in `src/`** (Community-Store-Bot flaggt es; Cross-Project-Lesson aus paperize). Reines Browser/Obsidian-JS.
- **`src/core/` importiert niemals `obsidian`** — pur & node-testbar. Obsidian-Kopplung lebt ab Plan 2 in `src/obsidian/`.
- `manifest.json`: `minAppVersion` **1.8.7**, `isDesktopOnly` **false**, `author` **Johannes Kaindl**.
- Lizenz **AGPL-3.0-or-later**.
- EPUB-Zielversion **EPUB3** (nav.xhtml + minimales NCX für Reader-Kompatibilität).
- ZIP: **store-only** (Methode 0), `mimetype` ist die **erste** Datei, unkomprimiert, ohne Extra-Feld.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts` | Build/Test-Scaffold |
| `manifest.json` | Obsidian-Plugin-Manifest |
| `src/main.ts` | Plugin-Stub (Commands/UI erst in Plan 2/3) |
| `src/core/model.ts` | Typen: `BookMetadata`, `Chapter`, `ImageAsset`, `Book` |
| `src/core/uuid.ts` | `generateUrnUuid` (RFC-4122 v4, injizierbarer RNG) |
| `src/core/frontmatter.ts` | FM-Record → `BookMetadata` (DE/EN-Aliase), `isBookNote`, Insert-Template |
| `src/core/spine-parser.ts` | Buch-Note-Body → geordnete Embed-Targets; Ordner-Sortierung |
| `src/core/dom-to-xhtml.ts` | gerenderter DOM + `RenderContext` → valides XHTML (graceful degradation) |
| `src/core/zip-writer.ts` | store-only ZIP (`createZip`) |
| `src/core/epub-builder.ts` | `Book` → EPUB3-Bytes (`buildEpub`), `DEFAULT_BOOK_CSS` |
| `tests/core/*.test.ts` | je Modul ein Testfile |

---

## Task 1: Projekt-Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `manifest.json`, `src/main.ts`
- Modify: `.gitignore` (append)

**Interfaces:**
- Consumes: nichts
- Produces: lauffähiges `npm install` / `npm run build` (→ `main.js`) / `npm test` / `npm run typecheck`

- [ ] **Step 1: `package.json` schreiben**

```json
{
  "name": "epub-exporter",
  "version": "0.0.1",
  "description": "Export Markdown notes as EPUB books from Obsidian.",
  "main": "main.js",
  "scripts": {
    "build": "node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "keywords": ["obsidian", "epub"],
  "author": "Johannes Kaindl",
  "license": "AGPL-3.0-or-later",
  "devDependencies": {
    "@types/node": "^20.11.0",
    "esbuild": "^0.20.0",
    "fflate": "^0.8.2",
    "jsdom": "^24.0.0",
    "obsidian": "latest",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` schreiben**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "module": "ESNext",
    "target": "ES2018",
    "moduleResolution": "node",
    "allowJs": true,
    "noImplicitAny": true,
    "strict": true,
    "strictNullChecks": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["DOM", "ES2018", "ES2020"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: `esbuild.config.mjs` schreiben**

```js
import esbuild from "esbuild";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 4: `vitest.config.ts` schreiben**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: `manifest.json` schreiben**

```json
{
  "id": "epub-exporter",
  "name": "EPUB Exporter",
  "version": "0.0.1",
  "minAppVersion": "1.8.7",
  "description": "Export a note — or a book note with embedded chapters — as an EPUB.",
  "author": "Johannes Kaindl",
  "authorUrl": "https://jkaindl.de",
  "isDesktopOnly": false
}
```

- [ ] **Step 6: `src/main.ts`-Stub schreiben**

```ts
import { Plugin } from "obsidian";

export default class EpubExporterPlugin extends Plugin {
  async onload(): Promise<void> {
    // Commands, ribbon and sidebar are wired in Plan 2 / Plan 3.
  }
}
```

- [ ] **Step 7: `.gitignore` ergänzen**

Hänge folgende Zeilen an die bestehende `.gitignore` an (falls noch nicht vorhanden):

```
node_modules/
main.js
*.epub
```

- [ ] **Step 8: Installieren, bauen, Leerlauf-Test**

Run: `npm install && npm run typecheck && npm run build`
Expected: `main.js` entsteht, kein Typfehler.

Run: `npm test`
Expected: vitest läuft, „No test files found" (0 Tests) — kein Fehler-Exit außer dem leeren-Suite-Hinweis; das ist ok für diesen Schritt.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs vitest.config.ts manifest.json src/main.ts .gitignore
git commit -m "chore: project scaffold (esbuild + vitest + manifest)"
```

---

## Task 2: `uuid.ts` — stabile urn:uuid-Generierung

**Files:**
- Create: `src/core/uuid.ts`
- Test: `tests/core/uuid.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `generateUrnUuid(rng?: () => number): string` → `"urn:uuid:xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"`

- [ ] **Step 1: Failing test schreiben**

`tests/core/uuid.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateUrnUuid } from "../../src/core/uuid";

describe("generateUrnUuid", () => {
  it("produces a v4 urn:uuid with correct shape", () => {
    const u = generateUrnUuid(() => 0.5);
    expect(u).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("is deterministic for a fixed rng", () => {
    expect(generateUrnUuid(() => 0.5)).toBe(generateUrnUuid(() => 0.5));
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/uuid.test.ts`
Expected: FAIL — Modul `../../src/core/uuid` nicht gefunden.

- [ ] **Step 3: Implementierung schreiben**

`src/core/uuid.ts`:

```ts
// Generate an RFC-4122 v4 URN for the EPUB dc:identifier.
// rng is injectable so tests stay deterministic; the plugin passes Math.random.
export function generateUrnUuid(rng: () => number = Math.random): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rng() * 256) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    "urn:uuid:" +
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/uuid.test.ts`
Expected: PASS (2 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/uuid.ts tests/core/uuid.test.ts
git commit -m "feat(core): urn:uuid generator for dc:identifier"
```

---

## Task 3: `model.ts` + `frontmatter.ts` — Metadaten aus Frontmatter

**Files:**
- Create: `src/core/model.ts`, `src/core/frontmatter.ts`
- Test: `tests/core/frontmatter.test.ts`

**Interfaces:**
- Consumes: `generateUrnUuid` aus Task 2
- Produces:
  - `interface BookMetadata`, `interface Chapter`, `interface ImageAsset`, `interface Book` (model.ts)
  - `isBookNote(fm): boolean`
  - `parseBookMetadata(fm, opts: { fallbackTitle, defaultLanguage, rng? }): BookMetadata`
  - `BOOK_FRONTMATTER_TEMPLATE: Record<string, unknown>`

- [ ] **Step 1: `model.ts` schreiben** (reine Typen, kein Test)

`src/core/model.ts`:

```ts
export interface BookMetadata {
  title: string;
  authors: string[];
  language: string;
  identifier: string; // urn:uuid:... (auto-filled if absent)
  description?: string;
  publisher?: string;
  date?: string;
  series?: string;
  seriesIndex?: string;
  subjects?: string[];
  rights?: string;
  modified?: string; // ISO 8601; EPUB3 dcterms:modified. Plugin supplies real time.
  coverImagePath?: string; // raw frontmatter value (e.g. "[[cover.png]]"); resolved in Plan 2
}

export interface Chapter {
  title: string;
  xhtml: string; // inner XHTML for the chapter body
  sourcePath?: string; // vault path, used for cross-chapter link resolution (Plan 2)
}

export interface ImageAsset {
  id: string; // OPF manifest id, e.g. "img-01"
  href: string; // path relative to OEBPS/, e.g. "images/img-01.png"
  mediaType: string; // e.g. "image/png"
  data: Uint8Array;
}

export interface Book {
  metadata: BookMetadata;
  chapters: Chapter[];
  images: ImageAsset[];
  coverImageId?: string; // ImageAsset.id of the cover, if any
  css: string;
}
```

- [ ] **Step 2: Failing test schreiben**

`tests/core/frontmatter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseBookMetadata,
  isBookNote,
  BOOK_FRONTMATTER_TEMPLATE,
} from "../../src/core/frontmatter";

const opts = { fallbackTitle: "Untitled", defaultLanguage: "en", rng: () => 0.5 };

describe("isBookNote", () => {
  it("is true for epub: true and false otherwise", () => {
    expect(isBookNote({ epub: true })).toBe(true);
    expect(isBookNote({ epub: "true" })).toBe(true);
    expect(isBookNote({ title: "x" })).toBe(false);
    expect(isBookNote(null)).toBe(false);
  });
});

describe("parseBookMetadata", () => {
  it("resolves German aliases", () => {
    const m = parseBookMetadata(
      { titel: "Mein Buch", autor: "Jay K", sprache: "de" },
      opts
    );
    expect(m.title).toBe("Mein Buch");
    expect(m.authors).toEqual(["Jay K"]);
    expect(m.language).toBe("de");
  });

  it("accepts an author list", () => {
    const m = parseBookMetadata({ author: ["A", "B"] }, opts);
    expect(m.authors).toEqual(["A", "B"]);
  });

  it("falls back to fallbackTitle and defaultLanguage", () => {
    const m = parseBookMetadata({}, opts);
    expect(m.title).toBe("Untitled");
    expect(m.language).toBe("en");
  });

  it("generates a urn:uuid identifier when absent", () => {
    const m = parseBookMetadata({}, opts);
    expect(m.identifier).toMatch(/^urn:uuid:/);
  });

  it("keeps a provided identifier", () => {
    const m = parseBookMetadata({ identifier: "isbn:123" }, opts);
    expect(m.identifier).toBe("isbn:123");
  });

  it("collects subjects/tags as an array", () => {
    const m = parseBookMetadata({ tags: ["a", "b"] }, opts);
    expect(m.subjects).toEqual(["a", "b"]);
  });
});

describe("BOOK_FRONTMATTER_TEMPLATE", () => {
  it("marks the note as a book", () => {
    expect(BOOK_FRONTMATTER_TEMPLATE.epub).toBe(true);
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: FAIL — `../../src/core/frontmatter` nicht gefunden.

- [ ] **Step 4: `frontmatter.ts` implementieren**

`src/core/frontmatter.ts`:

```ts
import { BookMetadata } from "./model";
import { generateUrnUuid } from "./uuid";

// Canonical field -> accepted frontmatter keys (English + German aliases).
const ALIASES: Record<string, string[]> = {
  title: ["title", "titel"],
  author: ["author", "autor", "authors", "autoren"],
  language: ["language", "sprache", "lang"],
  identifier: ["identifier", "id", "isbn"],
  description: ["description", "beschreibung"],
  publisher: ["publisher", "verlag"],
  date: ["date", "datum"],
  series: ["series", "serie", "reihe"],
  seriesIndex: ["series_index", "seriesIndex", "reihe_nr"],
  subject: ["subject", "subjects", "tags", "schlagworte"],
  rights: ["rights", "rechte", "lizenz"],
  cover: ["cover", "titelbild"],
};

function pick(fm: Record<string, unknown>, canonical: string): unknown {
  for (const key of ALIASES[canonical] ?? [canonical]) {
    const v = fm[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  return [String(v)].filter((s) => s.length > 0);
}

function asString(v: unknown): string | undefined {
  return v === undefined ? undefined : String(v);
}

export interface ParseOptions {
  fallbackTitle: string; // note basename, used when no title field is set
  defaultLanguage: string; // used when no language field is set
  rng?: () => number; // injectable for deterministic tests
}

export function isBookNote(fm: Record<string, unknown> | null | undefined): boolean {
  if (!fm) return false;
  const v = fm["epub"] ?? fm["book"];
  return v === true || v === "true";
}

export function parseBookMetadata(
  fm: Record<string, unknown>,
  opts: ParseOptions
): BookMetadata {
  const identifier = (pick(fm, "identifier") as string) || generateUrnUuid(opts.rng);
  return {
    title: (pick(fm, "title") as string) || opts.fallbackTitle,
    authors: asStringArray(pick(fm, "author")),
    language: (pick(fm, "language") as string) || opts.defaultLanguage,
    identifier,
    description: asString(pick(fm, "description")),
    publisher: asString(pick(fm, "publisher")),
    date: asString(pick(fm, "date")),
    series: asString(pick(fm, "series")),
    seriesIndex: asString(pick(fm, "seriesIndex")),
    subjects: asStringArray(pick(fm, "subject")),
    rights: asString(pick(fm, "rights")),
    coverImagePath: asString(pick(fm, "cover")),
  };
}

// Fields scaffolded by the "Insert book frontmatter" command (Plan 2).
// Canonical English keys; the user may rename to German aliases.
export const BOOK_FRONTMATTER_TEMPLATE: Record<string, unknown> = {
  epub: true,
  title: "",
  author: "",
  language: "en",
  cover: "",
  description: "",
  date: "",
  publisher: "",
  identifier: "",
  series: "",
  series_index: "",
  subject: [],
  rights: "",
};
```

- [ ] **Step 5: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/frontmatter.test.ts`
Expected: PASS (alle Tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/model.ts src/core/frontmatter.ts tests/core/frontmatter.test.ts
git commit -m "feat(core): book data model + frontmatter parsing with DE/EN aliases"
```

---

## Task 4: `spine-parser.ts` — Kapitel-Reihenfolge

**Files:**
- Create: `src/core/spine-parser.ts`
- Test: `tests/core/spine-parser.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `interface SpineEntry { target: string }`
  - `parseEmbedSpine(body: string): SpineEntry[]` — nur Zeilen, die **ausschließlich** aus einem `![[…]]`-Embed bestehen (Top-Level), in Dokumentreihenfolge; Alias (`|`) und Heading (`#`) werden vom Target entfernt
  - `sortFolderChapters(filenames: string[]): string[]` — numerisch-natürlich sortiert

- [ ] **Step 1: Failing test schreiben**

`tests/core/spine-parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEmbedSpine, sortFolderChapters } from "../../src/core/spine-parser";

describe("parseEmbedSpine", () => {
  it("extracts top-level embeds in order", () => {
    const body = `# Book\n\n![[01 Intro]]\n![[02 Body]]\n![[03 End]]\n`;
    expect(parseEmbedSpine(body).map((e) => e.target)).toEqual([
      "01 Intro",
      "02 Body",
      "03 End",
    ]);
  });

  it("ignores an embed inside a paragraph (not top-level)", () => {
    const body = `See ![[aside]] here.\n\n![[real-chapter]]\n`;
    expect(parseEmbedSpine(body).map((e) => e.target)).toEqual(["real-chapter"]);
  });

  it("strips alias and heading from the target", () => {
    const body = `![[folder/Note#Section|Alias]]\n`;
    expect(parseEmbedSpine(body)[0].target).toBe("folder/Note");
  });

  it("returns empty for no embeds", () => {
    expect(parseEmbedSpine("just prose\n")).toEqual([]);
  });
});

describe("sortFolderChapters", () => {
  it("sorts numerically (2 before 10)", () => {
    expect(sortFolderChapters(["10 z.md", "2 a.md", "1 b.md"])).toEqual([
      "1 b.md",
      "2 a.md",
      "10 z.md",
    ]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/spine-parser.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementierung schreiben**

`src/core/spine-parser.ts`:

```ts
export interface SpineEntry {
  target: string; // link target inside ![[ ]], without alias/heading
}

// A chapter is a line whose *entire* trimmed content is a single embed.
const TOP_LEVEL_EMBED = /^!\[\[([^\]]+)\]\]$/;

export function parseEmbedSpine(body: string): SpineEntry[] {
  const entries: SpineEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const m = rawLine.trim().match(TOP_LEVEL_EMBED);
    if (m) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      if (target) entries.push({ target });
    }
  }
  return entries;
}

// Folder mode: natural (numeric-aware) filename sort = chapter order.
export function sortFolderChapters(filenames: string[]): string[] {
  return [...filenames].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/spine-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/spine-parser.ts tests/core/spine-parser.test.ts
git commit -m "feat(core): spine parser (embed order + folder sort)"
```

---

## Task 5: `dom-to-xhtml.ts` — DOM → valides XHTML

**Files:**
- Create: `src/core/dom-to-xhtml.ts`
- Test: `tests/core/dom-to-xhtml.test.ts` (läuft im jsdom-Environment)

**Interfaces:**
- Consumes: nichts
- Produces:
  - `interface RenderContext { resolveImage(src): string | null; resolveInternalLink(target): string | null; onUnsupported(kind): void }`
  - `domToXhtml(root: Node, ctx: RenderContext): string`

**Hinweis zur Fidelity:** Diese Task deckt Standard-HTML-Elemente ab (Überschriften, Absätze, fett/kursiv, Listen, Zitate, Code, Tabellen, Links, Bilder). **Obsidian-klassenspezifische Konstrukte** (Callout-`div.callout`, MathJax-`mjx-container`) werden vorerst über den generischen Unsupported-Zweig zu Text degradiert; ihre gezielte Behandlung wird in Plan 2 gegen echten gerenderten DOM ergänzt (dort ist der reale DOM sichtbar). Das ist bewusst und kein stiller Gap.

- [ ] **Step 1: Failing test schreiben**

`tests/core/dom-to-xhtml.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { domToXhtml, RenderContext } from "../../src/core/dom-to-xhtml";

function ctx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    resolveImage: () => "images/x.png",
    resolveInternalLink: () => null,
    onUnsupported: () => {},
    ...over,
  };
}

function frag(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

describe("domToXhtml", () => {
  it("passes through standard block/inline elements", () => {
    const out = domToXhtml(frag("<h1>T</h1><p>a <strong>b</strong> c</p>"), ctx());
    expect(out).toBe("<h1>T</h1><p>a <strong>b</strong> c</p>");
  });

  it("escapes text content", () => {
    const out = domToXhtml(frag("<p>a < b & c</p>"), ctx());
    expect(out).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("rewrites image src via resolveImage and self-closes", () => {
    const out = domToXhtml(
      frag('<img src="local.png" alt="cap">'),
      ctx({ resolveImage: () => "images/img-01.png" })
    );
    expect(out).toBe('<img src="images/img-01.png" alt="cap"/>');
  });

  it("drops an image and reports unsupported when resolveImage returns null", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag('<img src="x.png">'), ctx({ resolveImage: () => null, onUnsupported }));
    expect(out).toBe("");
    expect(onUnsupported).toHaveBeenCalledWith("image");
  });

  it("keeps external links, resolves internal links, and plain-texts unknown internal links", () => {
    const ext = domToXhtml(frag('<a href="https://x.com">go</a>'), ctx());
    expect(ext).toBe('<a href="https://x.com">go</a>');

    const internal = domToXhtml(
      frag('<a data-href="Chap2" href="Chap2">go</a>'),
      ctx({ resolveInternalLink: () => "chapter-02.xhtml" })
    );
    expect(internal).toBe('<a href="chapter-02.xhtml">go</a>');

    const dangling = domToXhtml(
      frag('<a data-href="Nope" href="Nope">go</a>'),
      ctx({ resolveInternalLink: () => null })
    );
    expect(dangling).toBe("go");
  });

  it("degrades an unsupported element to a text paragraph and reports it", () => {
    const onUnsupported = vi.fn();
    const out = domToXhtml(frag("<math>E=mc2</math>"), ctx({ onUnsupported }));
    expect(out).toBe("<p>E=mc2</p>");
    expect(onUnsupported).toHaveBeenCalledWith("math");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementierung schreiben**

`src/core/dom-to-xhtml.ts`:

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

const VOID_TAGS = new Set(["br", "hr"]);
const PASSTHROUGH = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "em", "strong", "del", "s", "b", "i",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr", "br", "sup", "sub", "span", "div",
]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
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

  if (PASSTHROUGH.has(tag)) {
    if (VOID_TAGS.has(tag)) return `<${tag}/>`;
    return `<${tag}>${serializeChildren(el, ctx)}</${tag}>`;
  }

  // Unknown element (callout, math, embed container, ...) -> degrade to text.
  ctx.onUnsupported(tag);
  return `<p>${escapeText(el.textContent ?? "")}</p>`;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/dom-to-xhtml.test.ts`
Expected: PASS (alle Tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-to-xhtml.ts tests/core/dom-to-xhtml.test.ts
git commit -m "feat(core): DOM->XHTML serializer with injected resolvers + graceful degradation"
```

---

## Task 6: `zip-writer.ts` — store-only ZIP

**Files:**
- Create: `src/core/zip-writer.ts`
- Test: `tests/core/zip-writer.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `interface ZipEntry { path: string; data: Uint8Array }`
  - `createZip(entries: ZipEntry[]): Uint8Array` — schreibt Entries in gegebener Reihenfolge, Methode 0 (store), korrektes CRC-32, lokale Header + Central Directory + EOCD

- [ ] **Step 1: Failing test schreiben**

`tests/core/zip-writer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { createZip } from "../../src/core/zip-writer";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe("createZip", () => {
  it("produces a zip fflate can read back", () => {
    const zip = createZip([
      { path: "mimetype", data: enc("application/epub+zip") },
      { path: "OEBPS/a.txt", data: enc("hello") },
    ]);
    const files = unzipSync(zip);
    expect(dec(files["mimetype"])).toBe("application/epub+zip");
    expect(dec(files["OEBPS/a.txt"])).toBe("hello");
  });

  it("writes the first entry (mimetype) at offset 0, stored, name at byte 30", () => {
    const zip = createZip([{ path: "mimetype", data: enc("application/epub+zip") }]);
    // local file header signature
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    // compression method (offset 8) == 0 (store)
    expect(zip[8]).toBe(0);
    expect(zip[9]).toBe(0);
    // filename begins at byte 30
    expect(dec(zip.slice(30, 38))).toBe("mimetype");
  });

  it("round-trips binary data unchanged", () => {
    const bin = new Uint8Array([0, 1, 2, 255, 254, 128]);
    const files = unzipSync(createZip([{ path: "b.bin", data: bin }]));
    expect(Array.from(files["b.bin"])).toEqual(Array.from(bin));
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/zip-writer.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementierung schreiben**

`src/core/zip-writer.ts`:

```ts
// Minimal store-only (uncompressed) ZIP writer — sufficient for EPUB.
// Entries are written in the given order; pass "mimetype" first.

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed DOS date/time (1980-01-01 00:00) — avoids Date, keeps output deterministic.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); // store
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  for (const c of central) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/zip-writer.test.ts`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/zip-writer.ts tests/core/zip-writer.test.ts
git commit -m "feat(core): store-only ZIP writer (CRC-32, EPUB-ready)"
```

---

## Task 7: `epub-builder.ts` — `Book` → EPUB3-Bytes

**Files:**
- Create: `src/core/epub-builder.ts`
- Test: `tests/core/epub-builder.test.ts`

**Interfaces:**
- Consumes: `Book`, `Chapter`, `ImageAsset` (model.ts) · `createZip`, `ZipEntry` (zip-writer.ts)
- Produces:
  - `buildEpub(book: Book): Uint8Array`
  - `DEFAULT_BOOK_CSS: string`

- [ ] **Step 1: Failing test schreiben**

`tests/core/epub-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { buildEpub, DEFAULT_BOOK_CSS } from "../../src/core/epub-builder";
import { Book } from "../../src/core/model";

const dec = (u: Uint8Array) => new TextDecoder().decode(u);

function fixtureBook(): Book {
  return {
    metadata: {
      title: "My Book",
      authors: ["Jay K"],
      language: "en",
      identifier: "urn:uuid:12345678-1234-4123-8123-1234567890ab",
      subjects: ["fiction"],
      modified: "2026-01-01T00:00:00Z",
    },
    chapters: [
      { title: "Intro", xhtml: "<p>hello</p>" },
      { title: "Body", xhtml: '<p>world <img src="images/img-01.png" alt=""/></p>' },
    ],
    images: [
      { id: "img-01", href: "images/img-01.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
    ],
    css: DEFAULT_BOOK_CSS,
  };
}

describe("buildEpub", () => {
  it("puts mimetype first with the correct value", () => {
    const zip = buildEpub(fixtureBook());
    expect(dec(zip.slice(30, 38))).toBe("mimetype");
    const files = unzipSync(zip);
    expect(dec(files["mimetype"])).toBe("application/epub+zip");
  });

  it("emits a container.xml pointing at content.opf", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    expect(dec(files["META-INF/container.xml"])).toContain("OEBPS/content.opf");
  });

  it("lists both chapters in manifest and spine", () => {
    const opf = dec(unzipSync(buildEpub(fixtureBook()))["OEBPS/content.opf"]);
    expect(opf).toContain("<dc:title>My Book</dc:title>");
    expect(opf).toContain('href="chapter-01.xhtml"');
    expect(opf).toContain('href="chapter-02.xhtml"');
    expect(opf).toContain('<itemref idref="chapter-1"/>');
    expect(opf).toContain('<itemref idref="chapter-2"/>');
    expect(opf).toContain('href="images/img-01.png"');
  });

  it("wraps chapter bodies in XHTML and lists them in nav", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    const ch1 = dec(files["OEBPS/chapter-01.xhtml"]);
    expect(ch1).toContain("<title>Intro</title>");
    expect(ch1).toContain("<p>hello</p>");
    const nav = dec(files["OEBPS/nav.xhtml"]);
    expect(nav).toContain('<a href="chapter-01.xhtml">Intro</a>');
    expect(nav).toContain('<a href="chapter-02.xhtml">Body</a>');
  });

  it("embeds image bytes unchanged", () => {
    const files = unzipSync(buildEpub(fixtureBook()));
    expect(Array.from(files["OEBPS/images/img-01.png"])).toEqual([1, 2, 3]);
  });

  it("marks the cover image in the manifest when coverImageId is set", () => {
    const book = fixtureBook();
    book.coverImageId = "img-01";
    const opf = dec(unzipSync(buildEpub(book))["OEBPS/content.opf"]);
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('name="cover" content="img-01"');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/core/epub-builder.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementierung schreiben**

`src/core/epub-builder.ts`:

```ts
import { Book } from "./model";
import { createZip, ZipEntry } from "./zip-writer";

const MIMETYPE = "application/epub+zip";
const DEFAULT_MODIFIED = "2026-01-01T00:00:00Z";
const enc = (s: string) => new TextEncoder().encode(s);

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function wrapXhtml(title: string, lang: string, bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xmlEscape(lang)}" lang="${xmlEscape(lang)}">
  <head>
    <meta charset="utf-8"/>
    <title>${xmlEscape(title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
${bodyInner}
  </body>
</html>`;
}

function buildOpf(book: Book): string {
  const m = book.metadata;
  const modified = m.modified ?? DEFAULT_MODIFIED;

  const manifest: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles/book.css" media-type="text/css"/>`,
  ];
  book.chapters.forEach((_, i) => {
    manifest.push(
      `<item id="chapter-${i + 1}" href="${chapterFileName(i)}" media-type="application/xhtml+xml"/>`
    );
  });
  for (const img of book.images) {
    const props = img.id === book.coverImageId ? ` properties="cover-image"` : "";
    manifest.push(
      `<item id="${xmlEscape(img.id)}" href="${xmlEscape(img.href)}" media-type="${xmlEscape(img.mediaType)}"${props}/>`
    );
  }

  const spine = book.chapters
    .map((_, i) => `<itemref idref="chapter-${i + 1}"/>`)
    .join("\n    ");

  const creators = m.authors
    .map((a, i) => `<dc:creator id="creator-${i}">${xmlEscape(a)}</dc:creator>`)
    .join("\n    ");

  const optional = [
    m.description ? `<dc:description>${xmlEscape(m.description)}</dc:description>` : "",
    m.publisher ? `<dc:publisher>${xmlEscape(m.publisher)}</dc:publisher>` : "",
    m.date ? `<dc:date>${xmlEscape(m.date)}</dc:date>` : "",
    m.rights ? `<dc:rights>${xmlEscape(m.rights)}</dc:rights>` : "",
    ...(m.subjects ?? []).map((s) => `<dc:subject>${xmlEscape(s)}</dc:subject>`),
    m.series ? `<meta property="belongs-to-collection" id="c01">${xmlEscape(m.series)}</meta>` : "",
    m.series && m.seriesIndex
      ? `<meta refines="#c01" property="group-position">${xmlEscape(m.seriesIndex)}</meta>`
      : "",
    book.coverImageId ? `<meta name="cover" content="${xmlEscape(book.coverImageId)}"/>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xmlEscape(m.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${xmlEscape(m.identifier)}</dc:identifier>
    <dc:title>${xmlEscape(m.title)}</dc:title>
    <dc:language>${xmlEscape(m.language)}</dc:language>
    ${creators}
    ${optional}
    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;
}

function buildNav(book: Book): string {
  const items = book.chapters
    .map((c, i) => `<li><a href="${chapterFileName(i)}">${xmlEscape(c.title)}</a></li>`)
    .join("\n        ");
  return wrapXhtml(
    "Contents",
    book.metadata.language,
    `    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Contents</h1>
      <ol>
        ${items}
      </ol>
    </nav>`
  );
}

function buildNcx(book: Book): string {
  const navPoints = book.chapters
    .map(
      (c, i) => `<navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
      <content src="${chapterFileName(i)}"/>
    </navPoint>`
    )
    .join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(book.metadata.identifier)}"/>
  </head>
  <docTitle><text>${xmlEscape(book.metadata.title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;
}

export function buildEpub(book: Book): Uint8Array {
  const entries: ZipEntry[] = [];
  // mimetype MUST be first and stored (createZip stores everything).
  entries.push({ path: "mimetype", data: enc(MIMETYPE) });
  entries.push({ path: "META-INF/container.xml", data: enc(CONTAINER_XML) });
  entries.push({ path: "OEBPS/content.opf", data: enc(buildOpf(book)) });
  entries.push({ path: "OEBPS/nav.xhtml", data: enc(buildNav(book)) });
  entries.push({ path: "OEBPS/toc.ncx", data: enc(buildNcx(book)) });
  entries.push({ path: "OEBPS/styles/book.css", data: enc(book.css) });
  book.chapters.forEach((c, i) => {
    entries.push({
      path: `OEBPS/${chapterFileName(i)}`,
      data: enc(wrapXhtml(c.title, book.metadata.language, c.xhtml)),
    });
  });
  for (const img of book.images) {
    entries.push({ path: `OEBPS/${img.href}`, data: img.data });
  }
  return createZip(entries);
}

export const DEFAULT_BOOK_CSS = `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #ccc; }`;
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npx vitest run tests/core/epub-builder.test.ts`
Expected: PASS (alle Tests).

- [ ] **Step 5: Volle Suite + Typecheck + Build**

Run: `npm test && npm run typecheck && npm run build`
Expected: alle Tests grün, kein Typfehler, `main.js` baut.

- [ ] **Step 6: Commit**

```bash
git add src/core/epub-builder.ts tests/core/epub-builder.test.ts
git commit -m "feat(core): EPUB3 assembly (opf/nav/ncx/container) -> valid .epub bytes"
```

---

## Self-Review (durch den Planautor durchgeführt)

**1. Spec-Coverage (Abschnitte 2, 6.2–6.4):**
- Frontmatter-Set + Aliase → Task 3 ✅ · Kapitel-Auswahl/Reihenfolge (Embeds + Ordner) → Task 4 ✅ · Markdown→XHTML + interne Links + Bilder + graceful degradation → Task 5 ✅ (Obsidian-klassenspezifische Fälle bewusst nach Plan 2 verschoben, dort dokumentiert) · store-only ZIP + mimetype-first → Task 6 ✅ · EPUB3-Struktur (opf/nav/ncx/container/css/cover/UUID) → Task 7 ✅ · UUID → Task 2 ✅.
- **Nicht in Plan 1 (korrekt, gehört in Plan 2):** `processFrontMatter`-Insert-Command, `MarkdownRenderer`-Aufruf, Bild-Bytes/Cover aus Vault laden, Cross-Chapter-Link-Registry befüllen, führendes Prosa-Kapitel aus der Buch-Note, 4 Output-Ziele, i18n. **Plan 3:** Sidebar.

**2. Placeholder-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code. ✅

**3. Typ-Konsistenz:** `Book`/`Chapter`/`ImageAsset`/`BookMetadata` (Task 3) werden in Task 7 identisch konsumiert; `ZipEntry`/`createZip` (Task 6) in Task 7 identisch; `RenderContext`/`domToXhtml` (Task 5) in sich konsistent; `generateUrnUuid` (Task 2) in Task 3 identisch. ✅

**4. Ambiguitäts-Check:** „Kapitel = Zeile, die ausschließlich ein `![[…]]` ist" ist in Task 4 explizit getestet; `coverImagePath` bleibt roher FM-String (Auflösung Plan 2) — explizit im model.ts-Kommentar. ✅
