# EPUB Exporter — Design-Spec

> Status: **Design abgenickt** (2026-07-18) · Nächster Schritt: Implementierungsplan
> Repo: `obsidian-plugins/epub-exporter` (Greenfield) · Lizenz: AGPL-3.0 · `isDesktopOnly: false`

## 1. Zweck & Abgrenzung

Ein Obsidian-Plugin, das aus Markdown-Notes **EPUB3-Bücher** erzeugt — sowohl eine
Einzelnote als auch mehrere Notes zu einem Buch mit Kapiteln, Inhaltsverzeichnis und
Metadaten. Vault-nativ, voll offline, ohne npm-Runtime-Dependency, mobiltauglich.

**Geschwister im Ökosystem** (Muster-Geber, Kit-first):
- `obsidian-letterhead` — Note→Brief via Frontmatter-Set, eigener PDF-Writer, bilingual.
- `obsidian-paperize` — Note→PDF, DOM-Rendering mit graceful degradation, 4 Output-Ziele.

EPUB ist der dritte Geschwister-Typ (Note→Dokument), aber die Engine ist **einfacher**
als die der Geschwister: EPUB ist im Kern *XHTML + CSS in einem ZIP*, und Obsidian
rendert Markdown→HTML bereits selbst. Kein vendored PDF-Writer nötig — dafür ein
(kleiner) ZIP-Writer.

## 2. Kernmodell: Die Buch-Note als Single Source of Truth

Ein Frontmatter-Set (eingefügt via `app.fileManager.processFrontMatter`, exakt
Letterheads „Insert frontmatter"-Muster) macht aus einer Note ein Buch. Der Body trägt
die Kapitel als **geordnete Top-Level-`![[embeds]]`**:

```yaml
---
epub: true                    # Trigger: diese Note ist ein Buch
title: Der Titel des Buchs
author: Vorname Nachname       # oder YAML-Liste bei mehreren Autor:innen
language: de
cover: "[[cover.png]]"         # optionales Cover-Bild (Wikilink)
description: Klappentext
date: 2026-07-18
publisher:                     # optional
identifier:                    # leer → Plugin generiert stabile UUID (urn:uuid:…)
series:                        # optional, Calibre-kompatibel (belongs-to-collection)
series_index:                  # optional
subject:                       # optional, Tags/Schlagworte (Liste)
rights:                        # optional
---

# Mein Buch

![[01 Vorwort]]
![[02 Einleitung]]
![[03 Hauptteil]]
```

**Design-Kern:** Weil Kapitel als Embeds vorliegen, ist die Buch-Note in Obsidians
Lesemodus **live als fertiges Buch sichtbar** — noch vor jedem Export. Das ist das
Alleinstellungsmerkmal gegenüber einer reinen Link-Liste (MOC).

### 2.1 Feld-Aliase DE/EN

Wie bei Letterhead: `titel`/`title`, `autor`/`author`, `sprache`/`language`,
`beschreibung`/`description`, `verlag`/`publisher`, `datum`/`date`. Der Nutzer schreibt
in seiner Sprache.

### 2.2 Kapitel-Feinschliff (optional, je Kapitel-Note)

```yaml
chapter_title: Eigener Kapiteltitel   # überschreibt H1/Dateiname als Kapiteltitel
epub_exclude: true                    # diese Note nicht als Kapitel aufnehmen
```

Frontmatter ist damit **Verfeinerung, nicht Auswahl** — die Auswahl/Reihenfolge kommt
aus den Embeds (bzw. dem Ordner).

### 2.3 „Was ist ein Kapitel?"

- Jedes **Top-Level-`![[embed]]`** in der Buch-Note = ein Kapitel (Spine-Item).
- Kapiteltitel-Auflösung: `chapter_title`-Frontmatter → sonst H1 der Note → sonst Dateiname.
- Freitext, den der Nutzer direkt in die Buch-Note schreibt (z.B. eine Widmung), wird
  zu einem eigenen führenden Kapitel.
- Verschachtelte Embeds (Embed *innerhalb* einer Kapitel-Note) = Inhalt, kein eigenes Kapitel.

## 3. Drei Repräsentationen eines Buchs (kein konkurrierender Modus, sondern Lebensphasen)

```
  Buch-Note (Frontmatter-Set + ![[embeds]] in Reihenfolge)   ← die EINE Quelle (SSOT)
        │                                    │
   [Export]                          [Consolidate to folder]  (Phase 2)
        ↓                                    ↓
   MeinBuch.epub                     📁 Buch/  _book.md
                                              01 - Kapitel.md  (+ Frontmatter)
                                              02 - …
```

Verschiedene Bücher dürfen unterschiedlich arbeiten; der Mechanismus wird aus dem
**Entry-Point** abgeleitet (worauf der Nutzer den Command/Button auslöst), **nicht** aus
einem globalen Setting. Consolidate/Import (Phase 2) sind **explizite Ein-Weg-Aktionen** —
kein kontinuierlicher Zwei-Wege-Sync (bewusst out-of-scope, Komplexitäts-Sumpf).

## 4. Commands & Entry-Points (Phase 1)

| Auslöser | Aktion | Spine-Quelle | Mutierend? |
|---|---|---|---|
| Command/Ribbon auf **Buch-Note** | `Als EPUB exportieren` | `![[embeds]]` in Reihenfolge | nein |
| Command/Ribbon auf **Einzelnote** | `Note als EPUB exportieren` | die Note selbst (1 Kapitel) | nein |
| **Rechtsklick auf Ordner** | `Ordner als EPUB exportieren` | Dateiname-Sortierung (zero-config) | nein |
| Command `Buch-Frontmatter einfügen` | scaffoldet das Feld-Set | — | Frontmatter der aktiven Note |

Alle Export-Wege sind **lesend**. Der Ordner-Export ist der zero-config-Schnellweg
(alternative Spine-Quelle: Dateiname-Sortierung statt Embed-Reihenfolge; Unterordner →
Buchteile als spätere Erweiterung).

## 5. Die Sidebar (`ItemView`, zusätzlich zu den Commands)

Kontext-sensitives Panel im rechten Sidebar, gebaut auf dem **vendored Hub-View-Muster**
(REGISTRY Z. 82: „eine Sidebar pro Plugin, mount-once"; node-testbare Variante
`buildInto`/`HubController` aus finance-ledger bzw. `buildInto`/`HubPanel` aus vault-rag —
Panel-Logik vom Obsidian-Mount getrennt, testbar ohne UI).

```
┌─ EPUB Exporter ─────────────┐
│ 📖 Kontext: Buch-Note        │   ← erkennt automatisch, worauf man steht
│ „Der Titel des Buchs"        │
│ Kapitel (aus ![[embeds]]):   │
│  ✓ 01 Vorwort                │   ✓ = Embed aufgelöst
│  ✓ 02 Einleitung             │   ⚠ = kaputter Link
│  ⚠ 03 Hauptteil (fehlt)      │
│ [ Als EPUB exportieren ]     │
│ [ Metadaten bearbeiten ]     │
├──────────────────────────────┤
│ (Einzelnote-Kontext:)        │
│ [ Note als EPUB ]            │
│ [ Zu Buch machen ]           │
└──────────────────────────────┘
```

**Wächst pro Phase:**

| Phase | Sidebar-Buttons zusätzlich |
|---|---|
| 1 | Kontext erkennen · Kapitelliste (mit Broken-Link-Warnung) · Export · Frontmatter einfügen |
| 2 | `[Consolidate to folder]` · `[Import folder as book]` |
| 3 | Kapitel per **Drag umsortieren** (schreibt Embed-Reihenfolge in die Buch-Note zurück) |

### 5.1 Dokumentierte Gotchas (aus REGISTRY, bereits gelöst)

- **Z. 91:** Buttons, die auf „die aktuelle Buch-Note" wirken, dürfen **nicht**
  `getActiveViewOfType(MarkdownView)` nutzen (der Klick macht das Panel zur aktiven
  View → `null`). Stattdessen `getMostRecentLeaf(rootSplit)` → zuletzt genutzte
  Haupt-Notiz.
- **Z. 37:** View **nicht** bei jedem Start auto-öffnen → Opt-in-Setting
  `openSidebarOnStartup` (Default aus), hinter `onLayoutReady` gegatet; immer per
  Ribbon/Command erreichbar.

## 6. Engine (der neue Kern)

Alles dep-frei und mobiltauglich → `isDesktopOnly: false`.

### 6.1 Rendering: Markdown → XHTML (Hybrid, zwei getrennte Ebenen)

1. **Spine-Auflösung (Link-Ebene):** Body der Buch-Note nach Top-Level-`![[embeds]]`
   parsen → geordnete Kapitelliste. Reines String/Link-Parsing, **node-testbar**.
2. **Kapitel-Rendering (DOM-Ebene):** Jede Kapitel-Note *einzeln* via Obsidians
   `MarkdownRenderer.render` → gerenderter DOM → **`dom-to-xhtml`**-Pass → sauberes,
   valides XHTML.

Warum Obsidians Renderer statt eigener Markdown-Parser: löst Wikilinks,
Embeds-im-Kapitel, Callouts & Obsidian-Flavored-Markdown gratis auf — vault-natives
Verhalten, das das Embed-Modell braucht. `dom-to-xhtml` ist die **Schwester** zu
Paperizes `dom-to-ir` (gleicher Ansatz: Obsidian-DOM durchlaufen, Unbekanntes graceful
degradieren) — nur Ziel XHTML statt PDF-IR.

**Testbarkeit:** `dom-to-xhtml` bleibt **pur** (DOM-Node rein → XHTML-String raus),
node-testbar mit Mock-DOM. Der `MarkdownRenderer`-Aufruf ist ein dünner Obsidian-Adapter
am Rand.

### 6.2 Fidelity-Scope

| Element | Verhalten |
|---|---|
| Überschriften, Absätze, fett/kursiv, `code`, Listen, Zitate, Trenner, Tabellen, Code-Blöcke | 1:1 semantisches XHTML |
| **Wikilink auf anderes Kapitel im Buch** | → interner EPUB-Link (`chapter-03.xhtml#…`) — echte Reader-Navigation |
| Wikilink auf Note *außerhalb* des Buchs | → Klartext (graceful) |
| **Bilder** (`![[img]]` / `![](…)`) | Bytes **as-is** ins EPUB-ZIP (`images/`), Pfad umgeschrieben — kein Re-Encoding (PNG/JPEG/GIF/SVG sind EPUB3-valid) |
| **Fußnoten** | → EPUB3-Fußnoten |
| Callouts, Math, Unbekanntes | graceful degradation + eine Sammel-Notice („N Elemente vereinfacht") — Paperizes bewährtes Muster |

### 6.3 EPUB-Assembly

EPUB3-Struktur:
- `mimetype` (stored/uncompressed, **erste** Datei im ZIP)
- `META-INF/container.xml`
- `OEBPS/content.opf` — Package: Metadaten (Dublin Core aus Frontmatter) + Manifest + Spine
- `OEBPS/nav.xhtml` — EPUB3-Navigation/TOC
- `OEBPS/toc.ncx` — minimales NCX für Kompatibilität mit älteren Readern/Kindle
- `OEBPS/chapter-NN.xhtml` — ein XHTML je Kapitel
- `OEBPS/images/…` — eingebettete Bilder
- `OEBPS/styles/book.css`

Fehlender `identifier` → Plugin generiert stabile `urn:uuid`.

### 6.4 ZIP-Writer: selbst gebaut & vendored

Wie Letterhead/Paperize ihren eigenen PDF-Writer mitliefern (zero runtime deps, offline,
mobile):
- **Store-only** (keine Kompression) → valides EPUB, ~100 Zeilen, trivial, node-testbar.
  Erfüllt die „mimetype uncompressed first"-Regel exakt. Größen-Penalty nur auf Text
  (klein); Bilder sind bereits komprimiert.
- **Optionale** Kompression über natives `CompressionStream('deflate-raw')` (in Electron
  & Mobile-WebView vorhanden) — progressive enhancement, Fallback auf store. Kein npm-Dep.
- **Kit-Kandidat** später (ZIP-Writer offensichtlich wiederverwendbar).

Fallback-Option (falls Eigenbau verworfen): `fflate` (~8KB, mobile-safe). Aktuelle
Entscheidung: **Eigenbau** (Zero-Dep-Ethos der Geschwister).

### 6.5 CSS

Minimales `book.css` (Typo, Überschriften-Abstände, `img{max-width:100%}`). **Keine
Farben** — E-Reader steuern Theme/Kontrast selbst. User-CSS als spätere Politur.

## 7. Peripherie

### 7.1 Output-Ziele (1:1 aus Paperize)

In Settings wählbar, Default „neben der Buch-Note":
1. Neben der Buch-Note (default)
2. Obsidian-Anhang-Ordner
3. Eigener Ordner (Setting)
4. Aus dem Vault teilen/öffnen (Mobile-Share-Sheet / OS-Default-App → E-Reader-App)

### 7.2 i18n & Settings (Kit-Reuse)

- **`obsidian-kit/pure/i18n.ts`** wiederverwenden → UI-Sprache folgt Obsidian (EN/DE).
  Buch-Sprache getrennt (das `language`-Frontmatter-Feld).
- **`obsidian-kit/pure/settings.ts`** (`mergeSettings`) für Settings-Merge/Migration.
- **Settings-Tab:** Output-Ziel · eigener Ordner · `openSidebarOnStartup`-Toggle
  (Opt-in) · Frontmatter-Feld-Referenz (wie Letterhead).

## 8. Repo- & Code-Struktur

Eigenständiges Git-Repo, **Kit als git-Tag-Dependency** (PROF-OBS-09, kein Monorepo).

```
src/core/          # pur, node-testbar
  model.ts           # Buch-/Kapitel-Datenmodell
  frontmatter.ts     # Feld-Set + Aliase DE/EN, processFrontMatter-Template
  spine-parser.ts    # Buch-Note-Body → geordnete Kapitelliste (Embeds/Ordner)
  dom-to-xhtml.ts    # gerenderter DOM → valides XHTML (graceful degradation)
  epub-builder.ts    # Kapitel + Metadaten → opf/nav/ncx/container/css
  zip-writer.ts      # store-only ZIP (+ optional CompressionStream)
  uuid.ts            # stabile urn:uuid-Generierung
src/i18n/
  strings.ts
src/obsidian/        # dünne Adapter
  main.ts            # Command-Registrierung, Ribbon, Lifecycle
  view.ts            # Sidebar (Hub-View-basiert)
  render-adapter.ts  # MarkdownRenderer.render-Wrapper
  settings.ts
  output.ts          # 4 Output-Ziele
src/vendor/kit/
  hub-view/          # vendored Hub-View
  (ggf. zip-writer bei Kit-Promotion)
```

Release-Infra (Dual-Push Codeberg→GitHub) beim Erst-Release via Skill
`plugin-release-setup`. AGPL-3.0, `author: Johannes Kaindl`.

## 9. Phasing & Out-of-Scope

| Phase | Inhalt |
|---|---|
| **1 (MVP, erster Ship)** | Buch-Frontmatter einfügen · Einzelnote→EPUB · Buch-Note(Embeds)→EPUB · Ordner→EPUB · Metadaten+Cover+TOC+interne Links+Bilder+Fußnoten · Sidebar (Kontext, Kapitelliste, Export, Frontmatter) · 4 Output-Ziele · i18n |
| **2** | Consolidate to folder · Import folder as book (explizite Ein-Weg-Aktionen) |
| **3** | Sidebar Drag-Umsortierung (schreibt Embed-Reihenfolge zurück) |

**Bewusst NICHT (v1):** kontinuierlicher Zwei-Wege-Sync · User-CSS · ISBN-Verwaltung/DRM ·
Multi-Buch-Bibliothek. Deflate-Kompression ist optional (store-only genügt).

## 10. Kit-first-Bilanz

- **Wiederverwenden:** `obsidian-kit/pure/i18n.ts`, `obsidian-kit/pure/settings.ts`,
  Hub-View-Muster (vendored), `obsidian-kit/testing/obsidian-mock.ts` (Tests).
- **Muster spiegeln (nicht Code):** Letterheads `processFrontMatter`-Insert,
  Paperizes `dom-to-ir`-Ansatz (→ `dom-to-xhtml`) + graceful-degradation-Notice +
  4 Output-Ziele + Repo-Layout (`core`/`i18n`/`obsidian`/`vendor`).
- **Neu & ggf. Kit-Kandidat:** `zip-writer.ts` (Registry-Eintrag nach Phase 1),
  `dom-to-xhtml` (bei 2. Consumer bewerten), EPUB-Builder.
- **Registry-Pflicht:** Nach Phase 1 Einträge für ZIP-Writer + EPUB-Assembly in
  `REGISTRY.md` (Kit-first-Regel Punkt 2).
