# EPUB Exporter — Phase 2 Design-Spec: Consolidate & Import

> Status: **Design abgenickt** (2026-07-23) · Nächster Schritt: Implementierungsplan (writing-plans)
> Baut auf: `2026-07-18-epub-exporter-design.md` §3, §9 (Phase 2)
> Vorbedingung: Phase 1 (Core-Engine, Rendering/Assembly, Runtime-Shell, Sidebar) ist auf `main`, Release 0.1.1 live.

## 1. Zweck & Abgrenzung

Phase 2 fügt die zwei **Repräsentations-Übergänge** aus dem Kernmodell hinzu (Design-Spec §3):
die Buch-Note (SSOT) und ihre Ordner-Repräsentation sind zwei **Lebensphasen** desselben Buchs,
verbunden durch zwei **explizite Ein-Weg-Aktionen**:

- **Consolidate to folder** — Buch-Note (verstreute `![[embeds]]`) → self-contained Buchordner. *Mutierend.*
- **Import folder as book** — Ordner mit Notes → Buch-Note (Folder-Note) mit Embed-Spine. *Additiv, nicht-destruktiv.*

Beide leiten den Modus aus dem **Entry-Point** ab (worauf man Command/Button/Kontextmenü auslöst),
**kein** globaler Modus-Schalter — konsistent mit Phase 1.

**Bewusst NICHT (YAGNI, wie Haupt-Spec §9):** kontinuierlicher Zwei-Wege-Sync · Merge in einen
bereits existierenden Ordner · Unterordner-als-Buchteile · Rück-Sync von Ordner-Edits in die
Quell-Notes.

## 2. Consolidate — Ziel-Layout

```
📁 Der Titel des Buchs/
   Der Titel des Buchs.md   ← Folder-Note: Frontmatter (kopiert) + ![[embeds]] auf lokale Kapitel
   01 - Vorwort.md
   02 - Einleitung.md
   03 - Hauptteil.md
   _assets/
     cover.png
     grafik-1.png …
```

- **Buch-Note benannt wie der Ordner** (Obsidian-Folder-Note-Konvention) → bleibt vollwertige
  Buch-Note (SSOT), im Lesemodus **live als Buch sichtbar**, direkt re-exportierbar. In Copy- UND
  Move-Modus identisches Layout.
- **Kapitel-Dateiname:** `NN - <Kapiteltitel>.md`, `NN` = zweistellige laufende Nummer aus der
  **Spine-Reihenfolge** (nicht aus einer Sortierung — die Embed-Reihenfolge *ist* die Reihenfolge).
  Kapiteltitel-Auflösung wie beim Export: `chapter_title`-Frontmatter → H1 → Original-Basename.
  Dateiname wird sanitisiert (dieselbe `sanitizeBase`-Logik wie die Output-Pfade in Phase 1).
- **Führende Prosa bleibt in der Buch-Note.** Freitext, den der Nutzer direkt in die Buch-Note
  schreibt (Widmung, Titel-H1), wird beim Export ohnehin zum führenden Kapitel (Haupt-Spec §2.3) —
  kein Extrahieren in eine eigene Datei. Nur die `![[embeds]]` werden auf die lokalen Kapitel umgebogen.
- **Frontmatter** der Quell-Buch-Note wird 1:1 in die neue Folder-Note übernommen; nur `cover:` wird
  ggf. auf den `_assets/`-Pfad umgeschrieben (siehe §5).

## 3. Consolidate — Bestätigungs-Modal

Consolidate ist die **erste mutierende Aktion** des Plugins (Phase 1 war komplett lesend). Entry-Points:
Command `Buch in Ordner konsolidieren`, Sidebar-Button (Buch-Note-Kontext), Ordner-Kontextmenü auf die
Buch-Note. Alle öffnen ein **`Modal`** (Obsidian-nativ, erstes Modal im Plugin):

- **Vorschau:** Zielordner-Name · Kapitelanzahl · Anzahl mitzunehmender Assets. Warnungen:
  - Zielordner existiert bereits → Optionen **Abbrechen** oder **Suffix** (`Der Titel des Buchs (2)`).
  - Im Move-Modus: Kapitel mit **externen** Backlinks (referenziert außerhalb dieses Buchs) →
    Hinweis, dass der Move diese Referenzen mitzieht.
- **Kapitel-Modus:** ⚪ Kopie / ⚪ Verschieben — vorbelegt aus Setting `consolidateChapterMode`.
- **Assets-Modus:** ⚪ Voll self-contained / ⚪ Nur Cover / ⚪ Keine — vorbelegt aus Setting
  `consolidateAssetMode`.
- **Bestätigen** führt aus; **Abbrechen** tut nichts.

### 3.1 Copy vs. Move

| | Kapitel-Dateien | Original-Buch-Note | Backlinks |
|---|---|---|---|
| **Kopie** | neue Dateien im Ordner, Originale unberührt | bleibt; **neue** Folder-Note wird erzeugt | unverändert |
| **Verschieben** | `fileManager.renameFile` in den Ordner (+ Umbenennung `NN - Titel`) | wird zur Folder-Note (verschoben + umbenannt) | Obsidian zieht alle Backlinks **und** die Embeds der Buch-Note automatisch nach |

- **Assets werden IMMER kopiert**, nie verschoben — sie stecken oft in mehreren Notes; ein Move
  würde sie in anderen Notes brechen.
- **Verschieben** nutzt konsequent `app.fileManager.renameFile`, damit Obsidians Link-Wartung greift.
  Die Reihenfolge im Executor ist wichtig: erst Ordner anlegen, dann Kapitel verschieben/kopieren,
  dann Assets kopieren + Links umschreiben, zuletzt die Buch-Note (Folder-Note) schreiben/verschieben,
  damit der Embed-Spine auf bereits final benannte Kapitel zeigt.

## 4. Import — nicht-destruktives Spiegelbild

Entry-Points: Ordner-Kontextmenü `Ordner als Buch importieren`, Sidebar-Button (Ordner-Kontext),
Command. **Kein Modal** — die Aktion ist additiv und trivial reversibel (eine neue Datei löschen).

- Legt `<Ordnername>.md` als **Folder-Note** im Ordner an.
- Frontmatter aus `BOOK_FRONTMATTER_TEMPLATE`; `title` = Ordnername, `language` = Default-Sprache,
  Rest leer/Default. Der Nutzer verfeinert danach.
- **Embed-Spine** aus `sortFolderChapters` (existiert bereits) über die `.md`-Dateien des Ordners
  (natürliche, numerisch-bewusste Dateinamen-Sortierung). Eine bereits existierende gleichnamige
  Folder-Note wird **nicht** überschrieben — stattdessen Notice + Abbruch.
- Kapitel-Dateien bleiben **unberührt** (kein Frontmatter-Insert, keine Umbenennung). Danach ist die
  Buch-Note sofort live sichtbar & exportierbar.

## 5. Assets-Handling (Consolidate)

Aus dem Modal / Setting `consolidateAssetMode`:

- **Voll self-contained:** Cover **und** alle in Kapiteln eingebetteten Bilder (`![[img]]`/`![](…)`)
  nach `_assets/` kopieren; Bild-Links im Kapiteltext auf den relativen `_assets/`-Pfad umschreiben.
  Portables Paket, funktioniert auch außerhalb des Vaults.
- **Nur Cover:** nur das Cover nach `_assets/` kopieren + `cover:`-Frontmatter umschreiben; inline-Bilder
  als Original-Wikilinks belassen (Obsidian löst sie beim Export weiter auf).
- **Keine Assets:** nur Markdown, alle Bild-Links unverändert.

Bild-Auflösung nutzt dieselben Ports wie Phase 1 (`metadataCache`/`vault`). Deduplizierung: dasselbe
Bild in mehreren Kapiteln → **eine** Kopie in `_assets/` (stabiler Key wie bei `image-registry.ts`).

## 6. Architektur (3-Schichten-Ethos, wie Phase 1)

**Pur (node-testbar, kein `obsidian`-Import) — die Entscheidungslogik:**

- **`src/core/consolidate-plan.ts`** — `buildConsolidatePlan(input) → ConsolidatePlan`. Input:
  Spine-Einträge (aufgelöst zu `{sourcePath, title, exists}`), Metadaten, Asset-Liste, Modus-Flags,
  existierende Ordnernamen (für Kollision). Output: geordnete Kapitel-Operationen
  `{sourcePath, targetName, index}`, Asset-Kopier-Liste + Link-Rewrites, finaler Ordnername
  (inkl. Suffix), Zähler übersprungener (kaputter) Embeds. **Keine** Vault-Mutation.
- **`src/core/import-plan.ts`** — `buildImportPlan(folderName, filenames, defaults) → ImportPlan`.
  Output: Folder-Note-Dateiname, Frontmatter-Objekt, Embed-Body (sortierter Spine). **Keine** Mutation.

**Obsidian-Adapter (dünn, führen den reinen Plan aus):**

- **`src/obsidian/consolidate.ts`** — `executeConsolidate(app, plan, mode)`: create Folder, copy/renameFile
  Kapitel, copy Assets, write/rename Buch-Note. Sammelt Teilfehler statt hart abzubrechen.
- **`src/obsidian/import.ts`** — `executeImport(app, plan)`: `vault.create` der Folder-Note.
- **`src/obsidian/consolidate-modal.ts`** — `Modal`-Subklasse: Vorschau + zwei Radio-Gruppen +
  Bestätigen/Abbrechen. Ruft `buildConsolidatePlan` für die Vorschau und `executeConsolidate` bei Bestätigung.

**Erweiterungen bestehender Dateien:**

- **`src/obsidian/settings.ts`** + Settings-Tab: `consolidateChapterMode: "copy" | "move"` (Default `copy`)
  und `consolidateAssetMode: "full" | "cover" | "none"` (Default `full`). Merge via vendored `mergeSettings`.
- **`src/obsidian/sidebar-render.ts`** / **`sidebar-model.ts`**: Buttons `[In Ordner konsolidieren]`
  (Buch-Note-Kontext) und `[Ordner als Buch importieren]` (Ordner-Kontext).
- **`src/main.ts`**: Commands + Ordner-Kontextmenü-Einträge + Modal-Wiring.
- **`src/i18n/strings.ts`**: neue EN/DE-Keys (Parity-Test hält sie gleich).

## 7. Fehlerbehandlung

- **Zielordner existiert** → Modal-Vorschau warnt, Suffix-Option oder Abbrechen. Import: Notice + Abbruch
  bei bereits existierender Folder-Note.
- **Kaputte/fehlende Embeds** → im Plan als übersprungen markiert und in einer Sammel-Notice gezählt
  (Paperizes graceful-degradation-Muster, wie beim Export).
- **Move mit externen Backlinks** → Vorschau-Warnung; der Nutzer entscheidet (Obsidian zieht die
  Referenzen ohnehin korrekt nach — es ist ein Hinweis, kein Fehler).
- **Executor-Teilfehler** (z.B. ein Asset nicht lesbar) → sammeln, am Ende eine Notice, den Rest
  fertigstellen; nicht mitten in der Mutation abbrechen. Da erst der reine Plan berechnet wird, ist der
  Executor eine simple, testbare Schleife.

## 8. Tests

- **Reine Planer voll node-testbar:** Nummerierung/Reihenfolge, Titel-Auflösung + Sanitizing,
  Link-Rewrite, Kollisions-Suffix, Asset-Dedup/-Sammlung, übersprungene Embeds; Import-Sortierung +
  Frontmatter-Scaffold + gleichnamige-Note-Guard.
- **Executor gegen `tests/mocks/obsidian.ts`** (Vault-/fileManager-Stub erweitern soweit nötig):
  Copy erzeugt Dateien ohne Originale zu berühren; Move ruft `renameFile`; Assets werden kopiert nie
  verschoben; Reihenfolge Ordner→Kapitel→Assets→Buch-Note.
- **i18n-Parity-Test** deckt die neuen Keys ab.
- **GUI-Smoke als `/user-handover`** (wie Phase 1): Consolidate Copy + Move, Import, und ein
  **Round-Trip** (Consolidate → Import ergibt ein äquivalentes Buch) am Test-Buch.

## 9. Kit-first & Wiederverwendung

- **`sortFolderChapters`** (spine-parser) und **`parseEmbedSpine`** werden von den Planern wiederverwendet.
- **`sanitizeBase`** (Output-Pfad-Logik aus Phase 1) für Kapitel-Dateinamen wiederverwenden — ggf. nach
  `src/core/` heben, falls noch im Obsidian-Layer.
- **`BOOK_FRONTMATTER_TEMPLATE`** (frontmatter) fürs Import-Scaffold.
- Bild-Auflösung/-Dedup spiegelt `image-registry.ts`.
- **Modal** ist neu im Plugin — Obsidian-`Modal`-Basisklasse, minimal, theme-neutrales CSS (an `styles.css`
  anhängen), UI-STANDARD.md (Obsidian-nativ) befolgen.

## 10. Phasing-Kontext

Nach Phase 2 offen: **Phase 3** (Sidebar-Drag-Umsortierung, schreibt Embed-Reihenfolge zurück) und der
**Plan-4-Carry-forward M2** (Live-Refresh bei In-Place-Embed-Edits via `metadataCache.on("changed")`) —
beide fassen denselben Re-Render-/Spine-Schreibpfad an und werden dort gemeinsam betrachtet.
