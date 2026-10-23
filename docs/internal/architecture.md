# Aufbau von epub-exporter

Modul-Layout und Kernmodell. Das Warum steht in `docs/internal/decisions.md`, die Regeln im Kern (`AGENTS.md`), die Fallstricke unter `.claude/rules/`.

## Schichten

- `src/core/*` ist pur, Obsidian-frei und node-testbar. `src/obsidian/*` ist die Runtime-Shell, die die Obsidian-API berührt. `src/vendor/kit/*` ist die vendorte pure Kit-Schicht (`i18n`, `settings`, `vault-path`, `filename-template`, `crc32`), `src/vendor/kit-obsidian/*` die Obsidian-gekoppelte (`confirm`, `folder-suggest`, `help-setting`, `settings_walker`, `share-export`). Den verbindlichen Stand nennen die `VENDOR.json`, nicht diese Aufzählung.
- `npm run check:pure` erzwingt, dass `src/core` und `src/vendor/kit` **kein** `obsidian` importieren (das Muster fängt beide Quote-Stile bei `from`-Importen, nicht `import()` oder `require`). Ausdrücklich **nicht** geprüft wird `src/vendor/kit-obsidian/`: dieser Ordner importiert `obsidian` bestimmungsgemäß und liegt genau deshalb getrennt (Begründung in `src/vendor/kit-obsidian/VENDOR.json`).

## Engine: einfacher als PDF

EPUB ist XHTML+CSS im ZIP; Obsidian rendert Markdown selbst zu HTML. Kern ist `dom-to-xhtml.ts` (Schwester zu paperizes `dom-to-ir`, gleiche graceful-degradation: Unbekanntes wird vereinfacht, nicht abgebrochen; der Zähler treibt die Sammel-Notice), ein **eigener store-only ZIP-Writer** (`zip-writer.ts`, gut 90 Zeilen, rein store-only, CRC-32 aus code-kit `crc32`, mimetype first) und `epub-builder.ts`. Der ZIP-Writer ist **Original-Code, kein Vendor**, im Ethos von Letterheads und Paperizes eigenem PDF-Writer, und ein Kit-Kandidat (REGISTRY).

## Kernmodell „Buch-Note als SSOT“

`frontmatter.ts` (DE/EN-Aliase, `isBookNote`, `BOOK_FRONTMATTER_TEMPLATE`) und `spine-parser.ts` (`parseEmbedSpine`/`sortFolderChapters`). Der **Entry-Point** bestimmt den Modus (Buch-Note / Einzelnote / Ordner), es gibt **keinen** globalen Modus-Schalter. `chapter_title` und `epub_exclude` sind je-Kapitel-Verfeinerung, keine Auswahl.

## Sidebar

Ein kontextsensitives Panel: pure Render-Funktion (`sidebar-render.ts`, `sidebar-model.ts`) getrennt vom `ItemView`-Mount (`hub-view.ts`), Brücke zur Obsidian-Schicht in `sidebar-bridge.ts`. Gotchas: `.claude/rules/sidebar.md`.

## Tests

`tests/mocks/obsidian.ts` ist ein minimaler Obsidian-Stand-in (`makeFakeEl`, `ItemView`, `PluginSettingTab`/`Setting`-Stubs), per vitest `resolve.alias` eingebunden: `src/`-Code, der `"obsidian"` importiert, ist node-testbar. Der Mock ist test-only, nie aus `src/` importiert. Ein Parity-Test hält die EN/DE-Key-Mengen in `src/i18n/strings.ts` gleich.
