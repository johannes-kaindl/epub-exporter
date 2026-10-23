# AGENTS.md — epub-exporter

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain. Begründete Abweichungen stehen unten unter „Abweichungen von der Leitkonvention".

Conventions for AI agents (Claude Code, Codex, …) working on this repository.

## Project character

Obsidian-Plugin „EPUB Exporter": exportiert Markdown-Notizen als **EPUB3-Buch**. Die **Buch-Note ist die Single Source of Truth** — ein Letterhead-artiges Frontmatter-Set plus geordnete `![[embeds]]` als Kapitel-Spine, wodurch das Buch in Obsidians Lesemodus **live als fertiges Buch sichtbar** ist. Geschwister: **paperize** (→PDF) und **letterhead** (→Geschäftsbrief) — gleiches Profil, anderes Ausgabeformat.

- **Plugin-ID:** `epub-exporter` (deployed unter `.obsidian/plugins/epub-exporter/`).
- **TS + esbuild:** `main.js` ist ein Build-Artefakt (`.gitignore`) — von `npm run build` bzw. der Release-Action aus `src/` erzeugt, **nicht** committet. `styles.css` **ist** committet und **Installations-Pflicht** (Obsidian lädt es automatisch aus dem Plugin-Ordner).

## Architecture principles

- **Drei Schichten:** `src/core/*` (pur, Obsidian-frei, node-testbar) · `src/obsidian/*` (Runtime-Shell) · `src/vendor/kit/*` (vendorte pure Kit-Module). `npm run check:pure` (ein `grep` in `package.json`, kein Script) verweigert `from "obsidian"` und `from 'obsidian'` in `src/core` und `src/vendor/kit`, kennt aber weder `import("obsidian")` noch `require` und schluckt Grep-Fehler; `src/vendor/kit-obsidian/` ist ausgenommen und trägt die Obsidian-gekoppelten Module. Den verbindlichen Stand nennt `src/vendor/kit/VENDOR.json`, nicht eine Aufzählung in der Prosa.
- **Dep-freie Engine:** EPUB = XHTML+CSS im ZIP; `dom-to-xhtml.ts` degradiert Unbekanntes, statt abzubrechen; der ZIP-Writer (`zip-writer.ts`) ist Original-Code, kein Vendor.
- **Buch-Note als SSOT:** Der **Entry-Point** bestimmt den Modus (Buch-Note / Einzelnote / Ordner) — **kein** globaler Modus-Schalter. **Kein Zwei-Wege-Sync** (bewusst out-of-scope).
- **Sidebar = EIN kontextsensitives Panel**, keine Tab-Maschinerie.
- **Settings-Tab deklarativ plus `display()`-Fallback:** deklarative Rows **statisch** halten, kein `visible`-Prädikat (Details in der Pfadregel).
- Aufbau und Warum: `docs/internal/architecture.md`, `docs/internal/decisions.md`.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run check:pure  # verweigert `from 'obsidian'`-Imports in src/core + src/vendor/kit (beide Quote-Stile)
npm run lint        # check-no-inline-disables.mjs + eslint src (eslint-plugin-obsidianmd)
npm run build       # esbuild --production → main.js (Build-Artefakt)
npm run gate        # typecheck + typecheck:test + typecheck:scripts + test + check:pure + lint + build — vor jedem Commit/Release
npm run smoke:gui   # GUI-Smoke gegen ein LAUFENDES Obsidian (docs/SMOKE.md)
npm run smoke:gui -- --setup   # Staging-Vault aus dem Fixture herstellen (einmal je Lauf-Runde)
npm run smoke:e2e   # Naht-Lauf über die Plugin-Grenze zu local-image-generator (+G1 mit --gpu); NICHT im Gate
npm run smoke:e2e -- --setup   # Staging-Vault + BEIDE Plugins deployen
sh tools/sync-kit.sh # Kit neu vendoren (Pins in tools/kit-sync.json); --check vergleicht nur
```

**Manuelles Deploy (kein `deploy`-Script):** frisch gebautes `main.js` (+ `manifest.json`/`styles.css` **nur bei Änderung**) nach `<vault>/.obsidian/plugins/epub-exporter/` kopieren, **dann Plugin neu laden** (aus-/einschalten oder Obsidian-Reload). **Gotcha:** Der Vault-Plugin-Ordner ist eine **Kopie, kein Symlink** — ein `npm run build` erreicht das laufende Plugin **nicht** von selbst. Ein veralteter Build maskiert sich als Code-Bug (die GUI zeigt altes Verhalten statt zu erroren). Diagnose vor jeder Code-Interpretation: ein Symbol der Änderung im deployten Bundle greppen (`grep -c <symbol> <…>/main.js`).

## Releasing

Läuft über das **zentrale** Release-Tooling `../tools/release/` — dieses Repo hat **kein** eigenes `scripts/release.mjs`. `npm run version-bump` / `preflight` / `release` delegieren dorthin und **erroren mit lesbarer Meldung**, wenn `../tools/release/` fehlt: **ein Clone ohne das Dach-Verzeichnis ist nicht release-fähig.** Mirror, Tag-Push, Store-Einreichung über das Developer Dashboard und Rescan: `../.claude/rules/release-und-store.md`.

## Conventions

- Conventional Commits; SemVer-Tags **ohne** v-Präfix; nur berührte Dateien stagen. Remotes: Forgejo `origin`; `github` (Store-Release-Action) bekommt Branch und Tag nur über `release.mjs`.
- **Store-Gate:** **kein** Inline-`// eslint-disable` in `src/` (erzwungen von `scripts/check-no-inline-disables.mjs`, erster Schritt von `npm run lint`; der Store wertet es als Error). Genuine Ausnahmen **nur** file-scoped in `eslint.overrides.mjs`, mit Begründung.
- i18n zweisprachig (EN/DE) in `src/i18n/strings.ts` — ein Parity-Test hält die Key-Mengen gleich.
- **Keine absoluten Pfade außerhalb des Repos** in committete Dateien — Platzhalter nutzen (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind erwünscht. Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`). SDD-Artefakte (Specs, Pläne) leben im Coding-Cockpit des Maintainers, nicht hier (CORE-META-12/14).
- Workspace-weite Standards: `_docs/CONVENTIONS.md` im Maintainer-Workspace (siehe Kopf; maintainer-lokal).

## Gotchas

- `main.js` **Build-Artefakt** (gitignored); `styles.css` dagegen committet + Installations-Pflicht.
- **Stale-Build-Deploy:** Plugin-Ordner ist Kopie, kein Symlink (siehe Commands → Deploy).
- **Release-Tooling zentral** (`../tools/release/`) — nicht lokal duplizieren.

## Context index

- Bevor du Einstellungen oder den Settings-Tab änderst, oder `eslint.overrides.mjs` anfasst: `.claude/rules/settings-tab.md`.
- Bevor du die Sidebar (`hub-view.ts`, `sidebar-*.ts`) änderst: `.claude/rules/sidebar.md`.
- Bevor du Code-Blöcke, `dom-to-xhtml.ts` oder das Rendern der Kapitel anfasst: `.claude/rules/code-blocks.md`.
- Bevor du den GUI-Smoke, den Naht-Lauf `smoke:e2e` oder `docs/SMOKE.md` änderst: `.claude/rules/gui-smoke.md`; Treiber-Regeln, Instanz und Lock des Dachs in `../.claude/rules/gui-smoke-treiber.md`, `../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`.
- Vor Änderungen an Modul-Layout, Engine oder Kernmodell: `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung (Buch-Note als SSOT, kein Zwei-Wege-Sync, eigener ZIP-Writer, statische Rows) übernimmst: `docs/internal/decisions.md`.
- Vor einem Release oder Store-Rescan: `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`.
- Vor UI-Arbeit: `../UI-STANDARD.md`, `../.claude/rules/ui-bausteine.md`; vor Änderungen an `styles.css`: `../.claude/rules/store-css.md`; vor README-Bildern: `../.claude/rules/readme-shots.md`.

## Memory

**Das Coding-Cockpit ist die SSOT** für Stand/Warum/Entscheidungen/History (`25_Coding/epub-exporter/epub-exporter.md` im Arbeits-Vault). Das Daemon-Memory unter `~/.claude/projects/<slug>/memory/` (Index: `MEMORY.md`) ist nur die **Zeiger-Schicht** aufs Cockpit — dauerhafte „Warum"-Erkenntnis gehört in Cockpit-§🧭, nicht als Dublette ins Memory. Session-Handoff unter `.remember/` (gitignored).

## Abweichungen von der Leitkonvention

Keine bekannten Abweichungen — Standard-Profil `ts-node · obsidian-plugin` (TypeScript + esbuild + vitest), wie die Geschwister paperize/vault-rag. Einzige Besonderheit ist das **zentrale** Release-Tooling (`../tools/release/`) statt eines lokalen `scripts/release.mjs`.

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `<code-workspace>/obsidian-plugins/`. **Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md` (Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im `obsidian-kit` bereits gelöst. **Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist verbindlich.
