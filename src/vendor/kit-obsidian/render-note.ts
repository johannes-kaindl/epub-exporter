// vendored from obsidian-kit@0.109.0, src/obsidian/render-note.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// render-note.ts — eine Notiz mit Obsidians Renderer in einen DOM-Baum holen, der VOLLSTÄNDIG gezeichnet ist: Host am Dokument, Frist, Mermaid-Wartezeit, Ruhe-Regel mit fester Obergrenze, Befunde statt Würfe.
//
// Warum es das gibt (Welle 36, Bestellung hypertext-exporter 1): drei Exporter rendern dieselbe Sache dreimal verschieden. epub-exporter (`deps.ts`) rendert in einen LOSEN Host ohne Frist, Letterhead im Vektor-Weg ebenso;
// nur Paperize (`export-desktop.ts`) hängt den Host ans Dokument. Gemessen am 2026-11-18 (Obsidian 1.15.1, 659 Dateien): im losen Host bleibt Mermaid ein Codeblock und die Callout-Symbole sind leer, im angehängten ist alles da.
//
// Herkunft: obsidian-paperize `src/obsidian/export-desktop.ts` (`renderDesktopPdf`, Host, `withTimeout`, `waitForMermaid`) und `styles.css` (`.paperize-render-host`). Unterschiede, mit Grund:
//   1. **Der Host trägt die Klasse `okit-render-note-host`, die Lage steht in `RENDER_NOTE_CSS`** (Verbraucher kopiert sie wortgleich in seine `styles.css`; Paperize hat dieselbe Regel als `.paperize-render-host`). `setCssProps` mit `position`
//      wäre ein `no-static-styles-assignment` (kit-lint.md); nur die Breite geht als Custom Property `--okit-render-width`. **Die Lage: im Sichtbereich, unsichtbar, mit fester Breite** (`position: fixed; left: 0; top: 0; width; opacity: 0;
//      pointer-events: none; z-index: -1`), NICHT außerhalb des Bildschirms: gemessen 2026-11-19 (Obsidian 1.15.1, Besteller hypertext-exporter, Etappe 0): ein Bases-Block zeichnet bei `left: -10000px` 0 von 13 Zeilen (die Toolbar sagt „13 results“,
//      die Tabelle ist leer), im Sichtbereich alle; ohne Breite bleibt er auch dort leer. Nie `display: none` (rendert Mermaid und Symbole nicht). Ohne die CSS-Zeilen rendert der Baum, der Host steht dann sichtbar im Dokument. Die Fassung 0.99.x
//      (`left: -10000px`, Paperize und die Messung 4a) ist damit ersetzt.
//   2. **Frist wirft nicht, sie meldet.** Paperize protokolliert den Fristablauf nur (`console.warn`) und wertet ihn nicht aus; hier steht er im Befund (`render-timeout`, `mermaid-missing`), das Plugin entscheidet über Meldung und Abbruch.
//   3. **Ruhe-Regel mit Obergrenze und Platzhalter-Urteil, neu.** Gemessen (2026-11-19, Etappe 0): für die Notiz selbst ist nach `await render` alles fertig, für Plugin-Blöcke nicht: Dataview steht nach `await render` noch als
//      `pre.dataview-error` „Loading...“ (Tabelle nach 8 bis 23 ms), Bases mit „Results“ statt „13 results“ im Zählerknopf (bis Ruhe 60 bis 80 ms, 39 bis 53 Mutationen nach der Rückkehr). Darum: erst fertig, wenn kein Platzhalter mehr steht UND das DOM
//      `quietMs` still war, höchstens `ceilingMs`. Das Urteil „Platzhalter“ ist eine Liste von Regeln (Selektor, optional mit Textbedingung; `RENDER_NOTE_PLACEHOLDERS`), nicht nur ein Selektor, weil `dataview-error` auch ein echter Fehler sein kann: es zählt
//      nur mit dem Text „Loading“. Der Zähler von Bases zählt als Platzhalter, solange sein Text keine Ziffer trägt (sprachunabhängig: „Results“ gegen „13 results“). Die Idee des Urteils stammt von vault-publisher (`render/settle.ts`, fremdes Plugin, nur gelesen).
//   4. **Ein verstecktes Fenster wird nicht gezeichnet.** Bei `document.visibilityState === "hidden"` drosselt der Renderer stark (gemessen: Codeblock minimiert 4,9 s gegen 0,14 s sichtbar, ein Satz von 51 Dateien kam in 180 s nicht zurück): der Baustein
//      zeichnet dann nicht, ruft `use` mit leerem Host und dem Befund `window-hidden`. `drawWhenHidden: true` hebt das auf. Die CDP-Fokus-Emulation (Standard der Pilot-Treiber) macht ein verstecktes Fenster `visible`; ein Plugin hat sie nicht.
//   5. **Eine fehlende Einbettung wird an der Klasse erkannt** (`mod-empty`, `mod-empty-attachment`; der Text ist sprachabhängig, gemessen im Profil `en`), meldet `embed-missing` mit dem `src` und braucht kein Warten (sofort fertig, 1 bis 4 ms).
//   6. **Der Baum lebt nur im Rückruf.** `withRenderedNote` räumt Host und Component selbst ab, auch bei einem Wurf des Verbrauchers; Berechnungen am angehängten Baum (Farben, Canvas, Maße) gehören in den Rückruf.
//
// Nicht Teil dieses Bausteins: Einfrieren (Bestellung 10), Vorbehandlung (21), Medien/Bilder (`inlineImages`), Links (7).
//
// **Nur Notiztext, kein Modelltext.** Der Baustein rendert Notizen des Nutzers für einen Export, wie Paperize und epub-exporter, ohne Linkschutz (`dom-guard`). Text aus einem Modell oder einer fremden Quelle gehört in `renderMarkdownGuarded`;
// im Dach steht die Stelle darum in `KEIN_TRAEGER` von `tools/linkschutz_check.py` (Entscheidung Kit-Master 2026-11-19, Welle 36).

import { Component, MarkdownRenderer, type App, type TFile } from "obsidian";
import { realClock, type ClockPort } from "./clock";
import { withTimeout } from "../kit/timeout";
import { errorMessage } from "../kit/error-message";
import { countFences } from "../kit/fences";
import { waitForMermaid, MERMAID_WAIT_TIMEOUT_MS } from "../kit/mermaid-wait";

export const RENDER_NOTE_TIMEOUT_MS = 10_000;
export const RENDER_NOTE_SETTLE_QUIET_MS = 250;
export const RENDER_NOTE_SETTLE_CEILING_MS = 4_000;
export const RENDER_NOTE_SETTLE_POLL_MS = 50;
export const RENDER_NOTE_WIDTH_PX = 800;
/** Frist, bis der Metadaten-Zwischenspeicher eine Zielnotiz mit Abschnitts-Einbettung kennt (Vorgabe 5 000 ms). */
export const RENDER_NOTE_CACHE_TIMEOUT_MS = 5_000;
/** Verbraucher kopiert die Konstante wortgleich in seine `styles.css`. Die Lage ist der Vertrag: am Dokument, IM Sichtbereich, unsichtbar, mit fester Breite; nie außerhalb des Bildschirms (Bases zeichnet dort 0 Zeilen) und nie `display: none`. */
export const RENDER_NOTE_CSS: string = `
.okit-render-note-host { position: fixed; left: 0; top: 0; width: var(--okit-render-width, 800px); opacity: 0; pointer-events: none; z-index: -1; }
`;
export const RENDER_NOTE_HOST_CLASS = "okit-render-note-host";
/** Eine Regel für „noch nicht fertig“: ein Selektor, bei dem nur die Treffer zählen, deren Text `textMatches` erfüllt (ohne Angabe zählt jeder Treffer). Die Selektoren sind einfach (Klasse oder Tag), damit der Fake-DOM der Tests sie liest. */
export type RenderNotePlaceholder = string | { selector: string; textMatches: RegExp };
/** Was als „noch nicht fertig“ gilt, ohne dass ein Plugin etwas angeben muss. Mermaid ist ausgenommen (eigener Befund). Gemessen 2026-11-19 (Obsidian 1.15.1):
 *  - `.is-loading`: Obsidians Einbettungen, solange sie laden.
 *  - `.dataview-error` mit Text „Loading…“: Dataview vor dem ersten Ergebnis (steht nach `await render` noch da, nach 8 bis 23 ms nicht mehr); ein echter Fehler trägt dieselbe Klasse und zählt nicht.
 *  - `.bases-toolbar-result-count` ohne Ziffer im Text: Bases, solange der Zähler „Results“ statt „13 results“ sagt. */
export const RENDER_NOTE_PLACEHOLDERS: readonly RenderNotePlaceholder[] = [
  ".is-loading",
  { selector: ".dataview-error", textMatches: /^\s*Loading/i },
  { selector: ".bases-toolbar-result-count", textMatches: /^\D*$/ },
];
/** Die Selektoren allein (Rückwärtsverträglichkeit mit 0.99.x-Entwürfen): nur die Regeln ohne Textbedingung. */
export const RENDER_NOTE_PLACEHOLDER_SELECTORS: readonly string[] = RENDER_NOTE_PLACEHOLDERS.filter((p): p is string => typeof p === "string");

export type RenderNoteFinding =
  /** `MarkdownRenderer.render` kam in `ms` nicht zurück; der Baum ist unvollständig. */
  | { kind: "render-timeout"; ms: number }
  /** Der Renderer hat geworfen; der Baum ist, was bis dahin stand. */
  | { kind: "render-failed"; message: string }
  /** Nach der Frist fehlen Diagramme (`.mermaid svg`). */
  | { kind: "mermaid-missing"; expected: number; drawn: number }
  /** Die Obergrenze der Ruhe-Regel ist erreicht, ohne dass das DOM still war oder die Platzhalter weg waren. */
  | { kind: "not-settled"; ms: number; placeholders: number }
  /** Das Fenster ist versteckt (`document.visibilityState === "hidden"`): es wurde nicht gezeichnet, der Host ist leer. */
  | { kind: "window-hidden" }
  /** Eine Einbettung hat kein Ziel (`mod-empty`, `mod-empty-attachment`); `target` ist ihr `src`. */
  | { kind: "embed-missing"; target: string }
  /** Eine Einbettung mit Abschnitt (`![[notiz#Abschnitt]]`) zeigt womöglich die ganze Notiz: der Metadaten-Zwischenspeicher kannte `target` (Pfad der Zielnotiz) nach `ms` noch nicht. Das Rendern lief trotzdem. */
  | { kind: "metadata-not-ready"; target: string; ms: number };

/** Was der Zwischenspeicher zu einer Zielnotiz weiß: `cache: null` = kein Eintrag ODER ein Eintrag, der nicht zum Dateistand passt (die Notiz wurde geändert, die Neuindizierung läuft noch; `isCacheEntryCurrent`), sonst der Eintrag; `embeds` sind die Links ihrer Einbettungen (für verschachtelte Abschnitts-Einbettungen). Eine Zielnotiz ohne Überschriften hat einen Eintrag und wartet nicht. */
export interface NoteCacheState { path: string; cache: { embeds: string[] } | null }

export interface RenderedNote {
  /** Der Host: hängt am Dokument, im Sichtbereich und unsichtbar, nur bis der Rückruf endet. */
  root: HTMLElement;
  findings: RenderNoteFinding[];
}

export interface RenderNotePorts {
  clock: ClockPort;
  sleep: (ms: number) => Promise<void>;
  render: (markdown: string, host: HTMLElement, sourcePath: string, component: { unload(): void }) => Promise<void>;
  createComponent: () => { unload(): void };
  /** Meldet jede Änderung unter `host`; die Rückgabe meldet den Beobachter ab. */
  observe: (host: HTMLElement, onChange: () => void) => () => void;
  /** `document.visibilityState` des Dokuments, in dem gezeichnet wird. */
  visibility: () => string;
  /** Löst `linkpath` (leer = die Quellnotiz selbst) wie ein Link auf und liest den Zwischenspeicher-Eintrag; `null`, wenn die Datei nicht existiert (dann gibt es nichts zu warten, `embed-missing` meldet es). */
  lookupNote: (linkpath: string, sourcePath: string) => NoteCacheState | null;
}

export interface RenderNoteSettleOptions { quietMs?: number; ceilingMs?: number; pollMs?: number }

export interface RenderNoteOptions {
  app: App;
  markdown: string;
  sourcePath: string;
  /** Vorgabe `activeDocument`. */
  doc?: Document;
  /** Breite des Hosts in Pixeln (bestimmt den Umbruch), Vorgabe 800. */
  widthPx?: number;
  /** Zusätzliche Klassen am Host (nach `markdown-preview-view markdown-rendered`). */
  hostClass?: string;
  /** Frist für `MarkdownRenderer.render`, Vorgabe 10 000 ms. */
  renderTimeoutMs?: number;
  mermaidTimeoutMs?: number;
  /** Erwartete Diagramme; Vorgabe die Zahl der mermaid-Fences im Text. */
  expectedMermaid?: number;
  settle?: RenderNoteSettleOptions;
  /** Frist für das Warten auf den Metadaten-Zwischenspeicher je Zielnotiz einer Abschnitts-Einbettung, Vorgabe 5 000 ms; bei Ablauf Befund `metadata-not-ready`. */
  cacheTimeoutMs?: number;
  /** Weitere Regeln für „noch nicht fertig“ (z. B. Platzhalter eines anderen Plugins); zusätzlich zu `RENDER_NOTE_PLACEHOLDERS`. */
  placeholderSelectors?: RenderNotePlaceholder[];
  /** Auch in einem versteckten Fenster zeichnen (Vorgabe `false`: Befund `window-hidden`, kein Zeichnen). */
  drawWhenHidden?: boolean;
  ports?: Partial<RenderNotePorts>;
}

function positive(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Passt der Zwischenspeicher-Eintrag zum Dateistand? `entry` ist `metadataCache.fileCache[pfad]`: INTERNES Feld (nicht in `obsidian.d.ts`), gemessen 2026-11-24 (Obsidian 1.15.1, Pilot `render-abschnitt`): nach `vault.modify` trägt der Eintrag noch `mtime` und `size` der alten Fassung und die alten Überschriften, bis die Neuindizierung durch ist (11 ms später); danach gleichen `mtime` und `size` denen von `file.stat`.
 *  Die öffentliche API nennt keinen Stand (`getFileCache` liefert die Überschriften, kein `mtime`; das Ereignis `changed` sagt nicht, ob eines aussteht). Rückfall, falls Obsidian das Feld entfernt: ohne lesbaren Eintrag (`undefined`, kein Objekt, `mtime`/`size` keine Zahlen) gilt der Eintrag als aktuell, also das Verhalten bis 0.108.0 (nur auf „kein Eintrag“ warten). */
export function isCacheEntryCurrent(entry: unknown, stat: { mtime: number; size: number }): boolean {
  if (typeof entry !== "object" || entry === null) return true;
  const e = entry as { mtime?: unknown; size?: unknown };
  if (typeof e.mtime !== "number" || typeof e.size !== "number") return true;
  return e.mtime === stat.mtime && e.size === stat.size;
}

function defaultPorts(app: App, clock: ClockPort, doc: Document): RenderNotePorts {
  return {
    clock,
    sleep: (ms) => new Promise<void>((resolve) => { clock.setTimeout(resolve, ms); }),
    render: (markdown, host, sourcePath, component) => MarkdownRenderer.render(app, markdown, host, sourcePath, component as Component),
    createComponent: () => new Component(),
    visibility: () => doc.visibilityState,
    lookupNote: (linkpath, sourcePath) => {
      const file: TFile | null = linkpath === "" ? app.vault.getFileByPath(sourcePath) : app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      if (!file) return null;
      const cache = app.metadataCache.getFileCache(file);
      const entry = (app.metadataCache as unknown as { fileCache?: Record<string, unknown> }).fileCache?.[file.path];
      return { path: file.path, cache: cache && isCacheEntryCurrent(entry, file.stat) ? { embeds: (cache.embeds ?? []).map((e) => e.link) } : null };
    },
    observe: (host, onChange) => {
      const Observer = (activeWindow as Window & typeof globalThis).MutationObserver;
      const obs = new Observer(onChange);
      obs.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
      return () => { obs.disconnect(); };
    },
  };
}

function countPlaceholders(host: HTMLElement, rules: readonly RenderNotePlaceholder[]): number {
  let n = 0;
  for (const rule of rules) {
    const selector = typeof rule === "string" ? rule : rule.selector;
    let hits: ArrayLike<Element>;
    try { hits = host.querySelectorAll(selector); } catch { continue; }
    if (typeof rule === "string") { n += hits.length; continue; }
    for (const el of Array.from(hits)) if (rule.textMatches.test(el.textContent ?? "")) n += 1;
  }
  return n;
}

/** Die Linkpfade der Einbettungen mit Abschnitt oder Block in `text` (`![[notiz#Abschnitt]]`, `![[#Abschnitt]]` → ""), ohne Anzeigetext, ohne Doppelte. Nur diese zeigen die ganze Notiz, wenn der Zwischenspeicher die Überschriften noch nicht kennt. */
export function sectionEmbedTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!\[\[([^\]\n|]*)(?:\|[^\]\n]*)?\]\]/g)) {
    const link = m[1] ?? "";
    const i = link.indexOf("#");
    if (i < 0) continue;
    const path = link.slice(0, i).trim();
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** Wartet, bis der Zwischenspeicher jede Zielnotiz einer Abschnitts-Einbettung kennt (auch verschachtelter, über deren `embeds`). Eine Datei, die es nicht gibt, und eine Notiz ohne die Überschrift warten NICHT: gewartet wird nur auf „kein Eintrag“. */
async function waitForEmbedTargets(markdown: string, sourcePath: string, ports: RenderNotePorts, timeoutMs: number, pollMs: number, findings: RenderNoteFinding[]): Promise<void> {
  const seen = new Set<string>();
  const queue: Array<{ linkpath: string; from: string }> = sectionEmbedTargets(markdown).map((linkpath) => ({ linkpath, from: sourcePath }));
  while (queue.length > 0) {
    const { linkpath, from } = queue.shift()!;
    const started = ports.clock.now();
    let state = ports.lookupNote(linkpath, from);
    while (state && !state.cache && ports.clock.now() - started < timeoutMs) {
      await ports.sleep(pollMs);
      state = ports.lookupNote(linkpath, from);
    }
    if (!state || seen.has(state.path)) continue;
    seen.add(state.path);
    if (!state.cache) { findings.push({ kind: "metadata-not-ready", target: state.path, ms: timeoutMs }); continue; }
    for (const link of state.cache.embeds) {
      const i = link.indexOf("#");
      if (i >= 0) queue.push({ linkpath: link.slice(0, i).trim(), from: state.path });
    }
  }
}

/** Rendert `markdown` in einen Host am Dokument und ruft `use` mit dem fertigen Baum und den Befunden. Host und Component sind danach weg (auch wenn `use` wirft). Wirft nie wegen Frist oder Renderer-Fehler: das steht in `findings`. */
export async function withRenderedNote<T>(opts: RenderNoteOptions, use: (note: RenderedNote) => T | Promise<T>): Promise<T> {
  const clock = opts.ports?.clock ?? realClock;
  const doc = opts.doc ?? activeDocument;
  const ports: RenderNotePorts = { ...defaultPorts(opts.app, clock, doc), ...opts.ports };
  const findings: RenderNoteFinding[] = [];
  const host = doc.body.createDiv({ cls: `${RENDER_NOTE_HOST_CLASS} markdown-preview-view markdown-rendered${opts.hostClass ? ` ${opts.hostClass}` : ""}` });
  host.setCssProps({ "--okit-render-width": `${positive(opts.widthPx, RENDER_NOTE_WIDTH_PX)}px` });
  host.setAttribute("aria-hidden", "true");   // im Sichtbereich, aber nicht für Vorlesegeräte
  const comp = ports.createComponent();
  const stopObserving = ports.observe(host, () => { lastChange = clock.now(); });
  let lastChange = clock.now();
  try {
    const renderMs = positive(opts.renderTimeoutMs, RENDER_NOTE_TIMEOUT_MS);
    const expectedMermaid = opts.expectedMermaid ?? countFences(opts.markdown, "mermaid");
    let rendered = false;
    const hidden = opts.drawWhenHidden !== true && ports.visibility() === "hidden";
    if (hidden) findings.push({ kind: "window-hidden" });
    else try {
      await waitForEmbedTargets(opts.markdown, opts.sourcePath, ports, positive(opts.cacheTimeoutMs, RENDER_NOTE_CACHE_TIMEOUT_MS), Math.max(1, positive(opts.settle?.pollMs, RENDER_NOTE_SETTLE_POLL_MS)), findings);
      const r = await withTimeout(ports.render(opts.markdown, host, opts.sourcePath, comp), renderMs, clock);
      if (r.timedOut) findings.push({ kind: "render-timeout", ms: renderMs });
      else rendered = true;
    } catch (e) {
      findings.push({ kind: "render-failed", message: errorMessage(e) });
    }
    if (rendered) {
      if (expectedMermaid > 0) {
        const { drawn, timedOut } = await waitForMermaid(host, expectedMermaid, {
          timeoutMs: positive(opts.mermaidTimeoutMs, MERMAID_WAIT_TIMEOUT_MS), sleep: ports.sleep, now: () => clock.now(),
        });
        if (timedOut) findings.push({ kind: "mermaid-missing", expected: expectedMermaid, drawn });
      }
      const quietMs = positive(opts.settle?.quietMs, RENDER_NOTE_SETTLE_QUIET_MS);
      const ceilingMs = positive(opts.settle?.ceilingMs, RENDER_NOTE_SETTLE_CEILING_MS);
      const pollMs = Math.max(1, positive(opts.settle?.pollMs, RENDER_NOTE_SETTLE_POLL_MS));
      const rules = [...RENDER_NOTE_PLACEHOLDERS, ...(opts.placeholderSelectors ?? [])];
      const started = clock.now();
      lastChange = started;
      for (;;) {
        const placeholders = countPlaceholders(host, rules);
        if (placeholders === 0 && clock.now() - lastChange >= quietMs) break;
        if (clock.now() - started >= ceilingMs) { findings.push({ kind: "not-settled", ms: ceilingMs, placeholders }); break; }
        await ports.sleep(pollMs);
      }
      for (const el of Array.from(host.querySelectorAll(".mod-empty, .mod-empty-attachment"))) findings.push({ kind: "embed-missing", target: el.getAttribute("src") ?? "" });
    }
    return await use({ root: host, findings });
  } finally {
    stopObserving();
    host.remove();
    comp.unload();
  }
}
