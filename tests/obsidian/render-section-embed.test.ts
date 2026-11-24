// @vitest-environment jsdom
// Wirkstelle des Kit-Renderers (obsidian-kit 0.109.0 `withRenderedNote`): ein Export mit `![[X#Teil 2]]` direkt nach dem Anlegen oder Ändern von X.
// Gemessen im Kit (Pilot `render-abschnitt`, Obsidian 1.15.1): solange der Metadaten-Zwischenspeicher X nicht (oder nur im alten Stand) kennt, zeigt die Einbettung die ganze Notiz.
// Hier zeichnet ein Ersatz-Renderer genau so: kennt der Zwischenspeicher den aktuellen Stand von X, nur den Abschnitt, sonst die ganze Notiz.
// Alles andere ist echter Code: `createAssemblerDeps().renderMarkdown` → vendortes `withRenderedNote` (Standard-`lookupNote` gegen die App) → `assembleBook` → XHTML.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { assembleBook, type AssemblerDeps, type NoteData } from "../../src/obsidian/book-assembler";
import { createAssemblerDeps, renderFindingMessage } from "../../src/obsidian/deps";
import { EN, DE } from "../../src/i18n/strings";

const X_STAT = { mtime: 2000, size: 40 };
const WHOLE = "<p>Teil 1 Text</p><p>Teil 2 Text</p>";
const SECTION = "<p>Teil 2 Text</p>";

/** Zwischenspeicher von X: `none` = kein Eintrag (neu angelegt), `stale` = Eintrag der alten Fassung (nach `vault.modify`), `current` = indiziert. Wechselt nach `readyAfterPolls` Wartezügen auf `current`. */
function makeWorld(initial: "none" | "stale", readyAfterPolls: number) {
  let state: "none" | "stale" | "current" = initial;
  let polls = 0;
  let now = 0;
  const xFile = { path: "X.md", basename: "X", extension: "md", stat: X_STAT };
  const headings = (s: typeof state) => s === "none" ? null : { headings: [{ heading: s === "stale" ? "Alt" : "Teil 2" }], embeds: [] };
  const app = {
    vault: { getFileByPath: (p: string) => (p === "X.md" ? xFile : null) },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => (link === "X" ? xFile : null),
      getFileCache: () => headings(state),
      get fileCache() {
        if (state === "none") return {};
        return { "X.md": state === "stale" ? { mtime: 1000, size: 30 } : { ...X_STAT } };
      },
    },
  } as unknown as App;
  const clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => {} };
  const sleep = async (ms: number) => {
    now += ms;
    polls += 1;
    if (polls >= readyAfterPolls) state = "current";
  };
  const doc = {
    body: {
      createDiv: (o: { cls: string }) => {
        const d = document.createElement("div") as HTMLDivElement & { setCssProps: (p: Record<string, string>) => void };
        d.className = o.cls;
        d.setCssProps = () => {};
        document.body.appendChild(d);
        return d;
      },
    },
  } as unknown as Document;
  const deps = createAssemblerDeps(app, {
    doc,
    cacheTimeoutMs: 5000,
    ports: {
      clock,
      sleep,
      visibility: () => "visible",
      observe: () => () => {},
      createComponent: () => ({ unload() {} }),
      render: async (_md, host) => { host.innerHTML = state === "current" ? SECTION : WHOLE; },
    },
  });
  return { deps };
}

function withFakeNotes(renderMarkdown: AssemblerDeps["renderMarkdown"]): AssemblerDeps {
  const notes: Record<string, NoteData> = { "Host.md": { path: "Host.md", basename: "Host", frontmatter: {}, body: "![[X#Teil 2]]" } };
  return {
    renderMarkdown,
    readNote: async (p) => notes[p] ?? null,
    resolveNotePath: (t) => (notes[t] ? t : null),
    readImage: async () => null,
    listFolderNotes: async () => [],
  };
}

const opts = { defaultLanguage: "en", rng: () => 0.5 };

describe("Export mit Abschnitts-Einbettung direkt nach Anlegen oder Ändern der Zielnotiz", () => {
  it("neu angelegt: das Kapitel zeigt nur den Abschnitt, kein Befund", async () => {
    const { deps } = makeWorld("none", 3);
    const res = await assembleBook(withFakeNotes(deps.renderMarkdown), { kind: "note", path: "Host.md" }, opts);
    expect(res.book.chapters[0].xhtml).toContain("Teil 2 Text");
    expect(res.book.chapters[0].xhtml).not.toContain("Teil 1 Text");
    expect(res.renderFindings).toEqual([]);
  });

  it("nach vault.modify (alter Eintrag im Zwischenspeicher): das Kapitel zeigt nur den Abschnitt", async () => {
    const { deps } = makeWorld("stale", 2);
    const res = await assembleBook(withFakeNotes(deps.renderMarkdown), { kind: "note", path: "Host.md" }, opts);
    expect(res.book.chapters[0].xhtml).not.toContain("Teil 1 Text");
    expect(res.renderFindings).toEqual([]);
  });

  it("Zwischenspeicher bleibt leer: Befund metadata-not-ready mit Pfad, Text in EN und DE", async () => {
    const { deps } = makeWorld("none", Number.MAX_SAFE_INTEGER);
    const res = await assembleBook(withFakeNotes(deps.renderMarkdown), { kind: "note", path: "Host.md" }, opts);
    expect(res.renderFindings).toEqual([{ notePath: "Host.md", finding: { kind: "metadata-not-ready", target: "X.md", ms: 5000 } }]);
    const fill = (table: Record<string, string>) => (key: string, ...args: (string | number)[]) =>
      (table[key] ?? `MISSING ${key}`).replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)]));
    const finding = res.renderFindings[0].finding;
    expect(renderFindingMessage(finding, fill(EN))).toBe("Obsidian had not indexed the embedded note X.md after 5000 ms; an embedded section of it may show the whole note.");
    expect(renderFindingMessage(finding, fill(DE))).toContain("X.md nach 5000 ms");
  });

  it("jede Befund-Art hat einen Text in EN und DE", () => {
    const all = [
      { kind: "render-timeout", ms: 1 }, { kind: "render-failed", message: "m" }, { kind: "mermaid-missing", expected: 2, drawn: 1 },
      { kind: "not-settled", ms: 1, placeholders: 1 }, { kind: "window-hidden" }, { kind: "embed-missing", target: "t" },
      { kind: "metadata-not-ready", target: "t", ms: 1 },
    ] as const;
    for (const table of [EN, DE]) for (const f of all) {
      const text = renderFindingMessage(f, (key) => table[key] ?? `MISSING ${key}`);
      expect(text, f.kind).not.toMatch(/^MISSING/);
    }
  });
});
