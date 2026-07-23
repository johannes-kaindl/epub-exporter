# Phase 3 — Kapitel-Sortierung in der Sidebar (Design)

**Datum:** 2026-07-23
**Status:** abgenickt, bereit für den Implementierungsplan
**Vorgänger:** Phase 1 (Plan 1–4), Phase 2 (Consolidate & Import, Release 0.2.0)

## 1. Ziel

Die Kapitelliste der Sidebar wird **sortierbar**. Die neue Reihenfolge wird sofort in den
`![[embed]]`-Spine der Buch-Notiz zurückgeschrieben — die Buch-Notiz bleibt damit die SSOT,
und das Buch ist im Lesemodus unmittelbar in der neuen Reihenfolge sichtbar.

Zusätzlich wird der offene Plan-4-Carry-forward **M2** geschlossen: Die Liste aktualisiert
sich künftig auch, wenn Embeds direkt in der offenen Notiz getippt oder gelöscht werden.

## 2. Getroffene Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Tabs wie vault-rag? | **Nein** — ein durchgehendes Panel | vault-rag hat fünf getrennte Arbeitsmodi; epub-exporter hat *einen* Gegenstand (das aktuelle Buch) und Aktionen dazu. Tabs zerrissen den natürlichen Ablauf *umsortieren → exportieren*. Bestätigt die YAGNI-Entscheidung aus Plan 4. |
| Wann wird geschrieben? | **Sofort beim Loslassen** | Entspricht der Erwartung an eine Drag-Geste; vermeidet den Zustand „Liste zeigt X, Datei enthält Y". Kein Speichern-Button, kein ungespeicherter Zwischenzustand. |
| Bedienung | **Ziehen + `Alt+↑/↓`** | Ziehen im ~250 px schmalen Panel ist feinmotorisch; die Tastenvariante nutzt dieselbe reine Funktion, kostet kaum Extra-Code und macht das Panel ohne Maus bedienbar. |
| M2 (Live-Refresh) | **In Phase 3 enthalten** | Fasst denselben Re-Render-Pfad an; das Cockpit empfiehlt die Kopplung ausdrücklich. |

## 3. Kernentscheidung: rohe Zeilen umsortieren, nie rekonstruieren

Der Spine wird **nicht** neu erzeugt, sondern in sich permutiert.

`parseEmbedSpine` wirft beim Parsen Alias und Heading weg
(`m[1].split("|")[0].split("#")[0]`). Würde man die Embed-Zeilen aus den geparsten Zielen neu
aufbauen — so wie `buildConsolidatePlan` es beim Konsolidieren tut —, würde aus
`![[Kapitel 1|Vorwort]]` beim ersten Ziehen still `![[Kapitel 1]]`. Das ist exakt die
Bug-Klasse, die das Phase-2-Review in `rewriteImageRefs` gefunden hat (Alias-/Größen-Suffix
verloren).

**Modell:** Die Positionen der Top-Level-Embed-Zeilen im Body sind *Slots*. Umsortieren heißt,
welcher **unveränderte Zeilentext** in welchem Slot steht. Daraus folgt strukturell:

- Aliase und Headings überleben, weil sie nie angefasst werden.
- Prosa, Überschriften, Leerzeilen und Einrückung zwischen den Embeds bleiben byteidentisch.
- Die Zeilenanzahl der Datei ändert sich nicht → minimaler, gut lesbarer Diff.
- Der bekannte Trailing-Prosa-Carry-forward aus Phase 2 tritt nicht auf, weil nichts
  regeneriert wird.

Die Regenerierung in `consolidate-plan.ts` bleibt unverändert — dort ist sie richtig, weil eine
*neue* Ordner-Notiz entsteht.

## 4. Architektur

Die bestehende Drei-Schichten-Ordnung bleibt unangetastet.

### 4.1 Reine Schicht — `src/core/spine-reorder.ts` (neu)

```ts
export type ReorderResult =
  | { ok: true; body: string }
  | { ok: false; reason: "noop" | "out-of-range" | "conflict" };

export function reorderSpine(
  body: string,
  from: number,
  to: number,
  expectedCount: number
): ReorderResult;
```

- Erkennt Embed-Zeilen mit **derselben** Regel wie `parseEmbedSpine` — die Regel wird dafür aus
  `spine-parser.ts` exportiert, statt sie zu duplizieren. Zwei divergierende Definitionen von
  „was ist ein Kapitel" wären ein Korrektheitsrisiko zwischen Anzeige, Export und Sortierung.
- `expectedCount` ist der Konfliktschutz: Weicht die Kapitelanzahl im Body zum Schreibzeitpunkt
  von der ab, die das Panel angezeigt hat, wurde die Notiz zwischenzeitlich fremd geändert →
  `conflict`, kein Schreibvorgang. Der Wert stammt aus dem angezeigten Modell
  (`model.chapters.length`) und wird von `onReorder` mitgereicht.
- Zeilenenden bleiben erhalten: Der vorherrschende Stil (`\r\n` vs `\n`) wird erkannt und beim
  Zusammenfügen wieder verwendet, damit keine Ganzdatei-Normalisierung im Diff landet.
- `from === to` → `noop` (kein Schreibvorgang, keine Meldung).

`parseEmbedSpine` selbst bleibt unverändert — es wird von `sidebar-model`, `consolidate` und dem
Assembler genutzt und ist nicht Teil dieser Änderung.

### 4.2 Modell — `src/core/sidebar-model.ts`

Der Array-Index eines `SidebarChapter` **ist** die Spine-Position — `buildBookChapters` läuft den
Spine bereits in Dokumentreihenfolge ab, es braucht also kein zusätzliches Positionsfeld.

Einzige Ergänzung: ein abgeleitetes Flag `canReorder`
(`context === "book" && chapters.length > 1`), damit der Renderer keine sinnlosen Ziehgriffe an
eine einelementige Liste hängt.

### 4.3 Renderer — `src/obsidian/sidebar-render.ts`

- Jede Kapitelzeile bekommt einen **Ziehgriff** (`setIcon(…, "grip-vertical")`), `draggable = true`
  und `tabindex = 0` (fokussierbar für die Tastaturvariante).
- `SidebarHandlers` wird um `onReorder(from: number, to: number): void` erweitert.
- Ereignisse: `dragstart` (Quellindex merken, `is-dragging` setzen) · `dragover`
  (`preventDefault` + Einfügemarke am Ziel) · `drop` (Zielindex bestimmen → `onReorder`) ·
  `dragend` (Klassen räumen).
- `keydown`: `Alt+↑` → `onReorder(i, i-1)`, `Alt+↓` → `onReorder(i, i+1)`, jeweils mit
  `preventDefault`.
- Die Funktion bleibt rein im bisherigen Sinn: Sie baut in den übergebenen Container und ruft
  injizierte Handler — damit weiterhin über `tests/mocks/obsidian.ts` node-testbar.

### 4.4 Ansicht — `src/obsidian/hub-view.ts`

Zwei Ergänzungen:

1. **Gesten-Sperre.** Während einer laufenden Drag-Geste (`dragstart` bis `dragend`) wird kein
   Neuaufbau ausgeführt; eintreffende Anforderungen werden vorgemerkt und beim Lösen der Sperre
   einmalig nachgeholt. Ohne das würde der Neuaufbau das gezogene Element mitten in der Geste
   zerstören — dieselbe Fehlerklasse wie die Zwei-Klick-Buttons aus Plan 4.
2. **M2-Listener.** `metadataCache.on("changed", file)` löst einen Neuaufbau aus, wenn `file` die
   aktuell angezeigte Zielnotiz ist. Die vorhandene Model-Key-Memoisierung verhindert weiterhin
   redundante Neuaufbauten.

**Keine gesonderte Echo-Unterdrückung.** Der eigene Schreibvorgang erzeugt genau den Zustand, den
das Panel anzeigen soll — der dadurch ausgelöste Neuaufbau ist erwünscht. Nötig ist allein das
Aufschieben *während* der Geste.

**Fokus nach dem Neuaufbau.** Da der Neuaufbau das DOM ersetzt, merkt sich die Ansicht die
Zielposition und fokussiert nach `renderSidebar` die entsprechende Zeile. Sonst bräche wiederholtes
`Alt+↑` nach dem ersten Druck ab.

### 4.5 Verdrahtung — `src/main.ts`

`onReorder` löst die Zielnotiz über das vorhandene `resolveTargetFile(app)` auf (gleicher Weg wie
Export und Konsolidieren) und schreibt **atomar** via `app.vault.process(file, …)`:

```
process(file, (body) => {
  const res = reorderSpine(body, from, to, expectedCount);
  return res.ok ? res.body : body;   // unverändert bei noop/conflict
})
```

`vault.process` ist `@since 1.1.0` und damit bei `minAppVersion 1.8.7` unbedenklich fürs
Store-Lint-Gate. Es ist gegenüber dem `vault.modify` aus Phase 2 das richtige Werkzeug, weil die
Buch-Notiz beim Ziehen typischerweise offen im Editor ist: Lesen und Schreiben sind ein Schritt,
statt einen zwischenzeitlichen Fremd-Edit zu überschreiben.

## 5. Datenfluss

```
Ziehen/Alt+↑↓
   ↓  onReorder(from, to)
main.ts → resolveTargetFile → vault.process
   ↓        reorderSpine(body, from, to, expectedCount)   [rein]
Datei geschrieben
   ↓  metadataCache "changed"
hub-view → bridge.snapshot() → buildSidebarModel → renderSidebar
   ↓
Panel zeigt die Reihenfolge AUS DER DATEI
```

**Die Datei ist die einzige Wahrheitsquelle.** Das Panel sortiert sich nicht optimistisch selbst
um; es zeigt stets, was tatsächlich in der Notiz steht. Damit gibt es keinen Zustand, in dem
Anzeige und Datei auseinanderlaufen — auch nicht, wenn ein Schreibvorgang scheitert.

## 6. Fehlerfälle

| Fall | Verhalten |
|---|---|
| `from === to` (Zeile auf sich selbst gezogen) | Kein Schreibvorgang, keine Meldung. |
| Index außerhalb des Bereichs (`Alt+↑` auf der ersten Zeile) | Kein Schreibvorgang, keine Meldung — die Grenze ist erwartbar, eine Meldung wäre Lärm. |
| Notiz zwischenzeitlich fremd geändert (Kapitelanzahl weicht ab) | `conflict` → Datei bleibt unangetastet, Notice „Die Buch-Notiz wurde zwischenzeitlich geändert.", Panel baut aus der Datei neu auf. |
| Schreibvorgang scheitert (Datei gelöscht, schreibgeschützt) | Notice mit Fehlertext, Panel baut aus der Datei neu auf → Liste springt sichtbar auf den echten Stand zurück. |
| Fehlende Kapitel (⚠) | Voll sortierbar — sie sind reguläre Spine-Einträge. |
| Weniger als zwei Kapitel | Keine Ziehgriffe, keine Tastaturbewegung. |
| Notiz-Kontext (kein Buch) | Unverändert; es gibt dort keine Kapitelliste. |

## 7. Ausdrücklich nicht enthalten

- **Kapitel per Ziehen hinzufügen oder entfernen.** Phase 3 permutiert nur Vorhandenes.
- **Ordner-Bücher sortieren.** Deren Reihenfolge ergibt sich aus dem Dateinamen
  (`sortFolderChapters`); ein Ordner ist zudem nie ein Sidebar-Kontext.
- **Embeds in Code-Blöcken.** `parseEmbedSpine` erkennt sie heute als Kapitel — das ist
  bestehendes Verhalten, das Anzeige *und* Export gleichermaßen betrifft. Es hier einseitig zu
  ändern, würde Sortierung und Export auseinanderlaufen lassen. Bleibt als bekannte Grenze.
- **Tabs / Mehr-Panel-Hub.** Siehe Abschnitt 2.

## 8. Teststrategie

**Rein (`spine-reorder`), node-getestet — der Schwerpunkt:**
Bewegung nach unten und oben · Alias `![[A|Alias]]` überlebt · Heading `![[A#H]]` überlebt ·
Prosa *zwischen* Embeds bleibt an Ort und Stelle · führende und nachgestellte Prosa unangetastet ·
CRLF bleibt CRLF · eingerückte Embeds · `noop` bei `from === to` · `out-of-range` ·
`conflict` bei abweichender Kapitelanzahl · Zeilenanzahl vor/nach identisch.

**Renderer, node-getestet über den vorhandenen Obsidian-Mock:**
Ziehgriff und `draggable` vorhanden · `onReorder` bekommt beim Loslassen die richtigen Indizes ·
`Alt+↑/↓` ruft `onReorder` · keine Griffe bei einem einzigen Kapitel.

**Ansicht:**
Neuaufbau wird während der Geste aufgeschoben und danach genau einmal nachgeholt ·
`changed`-Ereignis der Zielnotiz löst Neuaufbau aus, das einer fremden Notiz nicht.

**GUI-Smoke (Jay):** Der kritische Pfad ist *ein Kapitel ziehen und prüfen, dass die Buch-Notiz
danach unverändert bis auf die Kapitelreihenfolge ist* — insbesondere bei einer Notiz mit Alias-Embed
und Prosa zwischen den Kapiteln.

## 9. Weitere Berührungspunkte

- **i18n:** neue Schlüssel für Konflikt- und Fehler-Notice sowie den Ziehhinweis, EN + DE; der
  Parity-Test hält die Schlüsselmengen gleich.
- **`styles.css`:** Ziehgriff, `is-dragging`, Einfügemarke — ausschließlich über
  Theme-CSS-Variablen (UI-STANDARD).
- **REGISTRY:** `reorderSpine` ist ein plausibler Kit-Kandidat (Zeilen-permutierendes
  Umsortieren in Markdown-Listen) — nach der Umsetzung eintragen.
