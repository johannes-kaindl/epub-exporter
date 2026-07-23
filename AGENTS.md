# AGENTS.md — epub-exporter

> **Workspace-Standards:** Die verbindliche Leitkonvention steht in
> `../_docs/CONVENTIONS.md` (Modell comply-or-explain). Begründete Abweichungen
> stehen unten unter „Abweichungen von der Leitkonvention".

Conventions for AI agents (Claude Code, Codex, …) working on this repository.

## Project character

Obsidian-Plugin „EPUB Exporter": exportiert Markdown-Notizen als **EPUB3-Buch**. Die
**Buch-Note ist die Single Source of Truth** — ein Letterhead-artiges Frontmatter-Set plus
geordnete `![[embeds]]` als Kapitel-Spine, wodurch das Buch in Obsidians Lesemodus **live als
fertiges Buch sichtbar** ist (das Alleinstellungsmerkmal ggü. einer reinen Link-Liste/MOC).
Geschwister: **paperize** (→PDF) und **letterhead** (→Geschäftsbrief) — gleiches Profil,
anderes Ausgabeformat.

- **Plugin-ID:** `epub-exporter` (deployed unter `.obsidian/plugins/epub-exporter/`).
- **TS + esbuild:** `main.js` ist ein Build-Artefakt (`.gitignore`) — von `npm run build`
  bzw. der Release-Action aus `src/` erzeugt, **nicht** committet. `styles.css` **ist**
  committet und **Installations-Pflicht** (Obsidian lädt es automatisch aus dem Plugin-Ordner).

## Architecture principles

- **Drei Schichten:** `src/core/*` (pur, Obsidian-frei, node-testbar) · `src/obsidian/*`
  (Runtime-Shell, berührt die Obsidian-API) · `src/vendor/kit/*` (vendored pure Kit-Module:
  `i18n`, `settings`). `npm run check:pure` erzwingt, dass `src/core` + `src/vendor` **kein**
  `obsidian` importieren (Muster fängt beide Quote-Stile: `from "obsidian"` und `'obsidian'`).
- **Dep-freie Engine — einfacher als PDF:** EPUB = XHTML+CSS im ZIP; Obsidian rendert MD→HTML
  selbst. Kern: `dom-to-xhtml.ts` (Schwester zu paperizes `dom-to-ir`, gleiche
  graceful-degradation — Unbekanntes wird vereinfacht, nicht abgebrochen; der Zähler treibt die
  Sammel-Notice) + **eigener store-only ZIP-Writer** (`zip-writer.ts`, ~100 Zeilen, CRC-32,
  mimetype-first-uncompressed, optional native `CompressionStream`) + `epub-builder.ts`. Der
  ZIP-Writer ist **Original-Code, kein Vendor** — Zero-Dep-Ethos wie Letterheads/Paperizes
  eigener PDF-Writer, **Kit-Kandidat** (REGISTRY).
- **Kernmodell „Buch-Note als SSOT":** `frontmatter.ts` (DE/EN-Aliase, `isBookNote`,
  `BOOK_FRONTMATTER_TEMPLATE`) + `spine-parser.ts` (`parseEmbedSpine`/`sortFolderChapters`). Der
  **Entry-Point** bestimmt den Modus (Buch-Note / Einzelnote / Ordner) — **kein** globaler
  Modus-Schalter. `chapter_title`/`epub_exclude` sind je-Kapitel-**Verfeinerung**, keine Auswahl.
  **Kein Zwei-Wege-Sync** (bewusst out-of-scope, Komplexitäts-Sumpf).
- **Code-Block-Hijack-Guard (`code-blocks.ts`):** `MarkdownRenderer.render` führt **alle**
  registrierten Markdown-Prozessoren fremder Plugins aus → `<pre>` wird durch Widget-DOM ersetzt,
  Originalcode nicht rekonstruierbar. Fenced-Code wird **vor** dem Rendern rausgezogen
  (Platzhalter mit Leerzeilen isoliert — sonst geht er verloren, wenn ein Fence an einer
  Textzeile klebt) und **nach** `dom-to-xhtml` wieder eingesetzt.
- **Settings-Tab — deklarativ + `display()`-Fallback:** `getSettingDefinitions()` treibt auf
  Obsidian **1.13+** Rendering **und** die Settings-Suche; `display()` bleibt als dokumentierter
  **<1.13-Fallback** (obsidian.d.ts sanktioniert es explizit; `minAppVersion` ist **1.8.7**).
  `getControlValue`/`setControlValue` sind überschrieben (Sprach-Coercion, `customFolder`-Trim,
  Persistenz via `saveSettings`). **Load-bearing-Gotcha:** deklarative Rows **statisch** halten
  (kein `visible`-Prädikat) — dynamische Sichtbarkeit bräuchte `refreshDomState`/`update`, die
  **1.13-only** sind und das Store-Lint-Gate (`obsidianmd/no-unsupported-api`, **Error**) bei
  minAppVersion 1.8.7 blockt. Kontext wandert stattdessen in einen `desc`-Hinweis; der
  `display()`-Fallback behält für <1.13 die bedingte Zeile. `eslint.config.mjs` hält dafür einen
  **file-scoped** `@typescript-eslint/no-deprecated: off` (nur für `settings-tab.ts`, weil das
  behaltene `display()` deprecated-aber-sanktioniert ist). Bei minAppVersion > 1.13.0: `display()`
  + Override retiren, Rows dürfen dann dynamisch werden.
- **Sidebar = EIN kontextsensitives Panel:** bewusst **keine** Tab-Maschinerie wie die
  Geschwister-Hubs (YAGNI). Pure Render-Fn (`sidebar-render.ts`/`sidebar-model.ts`) vom
  `ItemView`-Mount (`hub-view.ts`) getrennt → node-testbar. Gotchas: `getMostRecentLeaf(rootSplit)`
  statt `getActiveViewOfType` (Panel-Klick → sonst null); Model-Key-Memoisierung überspringt
  redundanten Rerender bei `active-leaf-change` (sonst brauchen Buttons 2 Klicks); Opt-in-Autostart
  hinter `onLayoutReady`.
- **Test-Infra:** `tests/mocks/obsidian.ts` (minimaler Obsidian-Stand-in — `makeFakeEl`,
  `ItemView`, `PluginSettingTab`/`Setting`-Stubs) + vitest `resolve.alias` → `src/`-Code, der
  `"obsidian"` importiert, ist node-testbar. Der Mock ist **test-only**, nie aus `src/` importiert.
- **SDD-Artefakte liegen im Coding-Cockpit, nicht hier** (CORE-META-12/14): Specs/Plans tragen
  Arbeitskontext (Schwester-Repo-Interna, absolute Pfade). Das Repo behält die Design-Essenz —
  diese Gotchas plus `CHANGELOG.md`. **Keine absoluten Pfade außerhalb des Repos** in committete
  Dateien; im Zweifel Platzhalter (`<code-workspace>/…`, `$VAULT/…`).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run check:pure  # verweigert 'obsidian'-Imports in src/core + src/vendor (beide Quote-Stile)
npm run lint        # check-no-inline-disables.mjs + eslint src (eslint-plugin-obsidianmd)
npm run build       # esbuild --production → main.js (Build-Artefakt)
npm run gate        # typecheck + test + check:pure + lint + build — vor jedem Commit/Release
```

**Manuelles Deploy (kein `deploy`-Script):** frisch gebautes `main.js` (+ `manifest.json`/
`styles.css` **nur bei Änderung**) nach `<vault>/.obsidian/plugins/epub-exporter/` kopieren,
**dann Plugin neu laden** (aus-/einschalten oder Obsidian-Reload).
**Gotcha (LESSONS.md 2026-07-23):** Der Vault-Plugin-Ordner ist eine **Kopie, kein Symlink** —
ein `npm run build` erreicht das laufende Plugin **nicht** von selbst. Ein veralteter Build
maskiert sich als Code-Bug (die GUI zeigt altes Verhalten statt zu erroren). Diagnose vor jeder
Code-Interpretation: ein Symbol der Änderung im deployten Bundle greppen
(`grep -c <symbol> <…>/main.js`).

## Releasing

Läuft über das **zentrale** Release-Tooling `../tools/release/` — dieses Repo hat **kein**
eigenes `scripts/release.mjs` (es ist der erste Nutznießer des zentralen Toolings). `npm run
version-bump` / `preflight` / `release` delegieren dorthin und **erroren mit lesbarer Meldung**,
wenn `../tools/release/` fehlt: **ein Clone ohne das Dach-Verzeichnis ist nicht release-fähig.**

- Remotes: **Codeberg** `origin` (`jkaindl/epub-exporter`), **GitHub-Mirror**
  (`johannes-kaindl/epub-exporter`) — der GitHub-Push triggert die Store-Release-Action.
- **Store-Einreichung** übers Obsidian **Developer Dashboard** (community.obsidian.md) — der
  PR-Flow gegen `obsidianmd/obsidian-releases` ist seit Mai 2026 retired (PROF-OBS-14).

## Conventions

- Conventional Commits; SemVer-Tags **ohne** v-Präfix; nur berührte Dateien stagen.
- `main.js` ist Build-Artefakt (`.gitignore`) — nicht committen.
- **Store-Gate:** **kein** Inline-`// eslint-disable` in `src/` (erzwungen von
  `scripts/check-no-inline-disables.mjs`, erster Schritt von `npm run lint`; der Store wertet es
  als Error). Genuine Ausnahmen **nur** file-scoped in `eslint.config.mjs`, mit Begründung.
- i18n zweisprachig (EN/DE) in `src/i18n/strings.ts` — ein Parity-Test hält die Key-Mengen gleich.
- Workspace-weite Standards: `../_docs/CONVENTIONS.md`.

## Gotchas

- `main.js` **Build-Artefakt** (gitignored); `styles.css` dagegen committet + Installations-Pflicht.
- **Stale-Build-Deploy:** Plugin-Ordner ist Kopie, kein Symlink (siehe Commands → Deploy).
- **Settings:** deklarative Rows bei minAppVersion < 1.13 **statisch** halten (siehe Architecture).
- **Release-Tooling zentral** (`../tools/release/`) — nicht lokal duplizieren.

## Memory

**Das Coding-Cockpit ist die SSOT** für Stand/Warum/Entscheidungen/History:
`$VAULT/25_Coding/epub-exporter/epub-exporter.md` (Pallas-Vault). Das Daemon-Memory unter
`~/.claude/projects/<slug>/memory/` (Index: `MEMORY.md`) ist nur die **Zeiger-Schicht** aufs
Cockpit — dauerhafte „Warum"-Erkenntnis gehört in Cockpit-§🧭, nicht als Dublette ins Memory.
Session-Handoff unter `.remember/` (gitignored). Cross-project-Lektionen: `../_docs/LESSONS.md`.

## Abweichungen von der Leitkonvention

Keine bekannten Abweichungen — Standard-Profil `ts-node · obsidian-plugin` (TypeScript + esbuild +
vitest), wie die Geschwister paperize/vault-rag. Einzige Besonderheit ist das **zentrale**
Release-Tooling (`../tools/release/`) statt eines lokalen `scripts/release.mjs` — bewusst, damit
Bugfixes am Release-Weg nicht N-fach nachgezogen werden müssen (obsidian-plugins-Lektion 2026-07-20).

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `<code-workspace>/obsidian-plugins/`.
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im `obsidian-kit`
bereits gelöst.

**Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist
verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur Theme-CSS-Variablen).
