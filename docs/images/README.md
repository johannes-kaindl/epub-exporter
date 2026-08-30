# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist
der **Vertrag** dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es
steht — und wie man sie reproduzierbar neu aufnimmt.

Geprüft wird der Vertrag automatisch: `readme_lint.py` (Workspace-Werkzeug) gleicht
**Vertrag ↔ Dateien ↔ README-Einbettungen** in alle Richtungen ab. Ein Eintrag ohne Datei,
eine Datei ohne Eintrag und eine Einbettung ohne Vertragszeile sind je ein Befund.

## Status

**Stand 2026-08-30: fünf Bilder aufgenommen, `shots:check` grün.**

**Ein offener Punkt:** `reorder.gif` ist 820×1781, davon rund die untere Hälfte leer. Der
inhaltsbewusste Zuschnitt (`inhaltsBox`), der bei `sidebar-book.png` und `settings.png`
greift, hilft hier nicht — die Lesefläche (`.markdown-preview-sizer`) ist selbst ein
Volle-Höhe-Container, ihre Bounding-Box ist also nicht kleiner als das Panel. Wer das
angeht: nicht den Container messen, sondern dessen letztes Kind mit Text. Inhaltlich ist
das GIF korrekt (das Kapitel wandert, die Notiz zieht mit), es steht als verlinkte
380-px-Vorschau und liegt mit 1,3 MB unter dem 2-MB-Budget — deshalb ist es aufgenommen
und nicht blockierend. Dieser Abschnitt trägt nach
jedem Lauf das Ergebnis von `npm run shots:check` — bis dahin ist er ausdrücklich offen.
Das Repo war eines von vier Plugin-Repos (von 22) ohne `docs/images/`.

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard in `_docs/readme/readme-spec.json`
(`images`-Block). Kurzfassung:

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width="820"` | H/B ≤ 1.6 |
| `detail` | Vorschaubild `width="380"`, verlinkt auf die Vollauflösung | keine Höhengrenze |

- **Aufnahme bei 1200 px Breite**, Thumbs 380 px unter `thumbs/`.
- **Einbettung immer per `<img width="…">`**, nie mit `![](…)` — nackte Markdown-Syntax
  überlässt die Größe dem Container, und der ist auf GitHub (~820 px), Forgejo (unbegrenzt)
  und der Store-Seite verschieden.
- **Budget:** PNG ≤ 400 KB, GIF ≤ 2048 KB, Ordner-Summe ≤ 5120 KB.
- **Alt-Texte sind Inhalt, nicht Form** — sie beschreiben, was zu sehen ist, nicht „Screenshot".

## Die Bilder

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero | beide READMEs, nach den Badges | Eine **Buch-Notiz im Lesemodus**, links daneben das geöffnete Panel mit der Kapitelliste. Das Bild muss den Kernsatz des Plugins ohne Bildunterschrift transportieren: *die Notiz **ist** das Buch* — die eingebetteten Kapitel stehen als fortlaufender Text da, nicht als Linkliste. Querformat. |
| `sidebar-book.png` | detail | beide READMEs, § Usage | Das Panel im **Buch-Kontext**: Kontextzeile `BOOK NOTE`, der Buchtitel, Abschnitt `Chapters` mit allen fünf Kapiteln samt **Greifpunkten** und Status-Häkchen, und die drei Schaltflächen `Export as EPUB`, `Edit metadata`, `Consolidate to folder`. ⚠️ **Nicht** der Text `Drag to reorder · Alt+↑/↓` — der ist ein `title`-Attribut auf der Kapitelzeile (`sidebar-render.ts:82`), also ein Tooltip, und in einem Screenshot grundsätzlich unsichtbar. Der erste Entwurf dieses Vertrags forderte ihn, weil er in `strings.ts` steht; sichtbar ist stattdessen der Greifpunkt. |
| `reorder.gif` | detail | beide READMEs, § Usage | Ein Kapitel wandert per `Alt+↓` an eine andere Position, **und die Embed-Zeile in der Notiz wandert sichtbar mit**. Ohne diese zweite Hälfte zeigt das GIF nur eine Liste, die sich sortiert — der Punkt ist, dass die Notiz die Quelle bleibt. ≤ 2 MB. |
| `consolidate-modal.png` | feature | beide READMEs, § Usage | Das Bestätigungs-Modal `Consolidate to folder` mit der Zusammenfassungszeile (`Folder “…” · N chapter(s)`) und **beiden** Auswahlgruppen: Kapiteldateien `Copy (keep originals)` / `Move (originals relocate)` und Bilder `Full — cover + all chapter images` / `Cover only` / `None`. |
| `settings.png` | detail | beide READMEs, § Configuration | Der vollständige Einstellungen-Tab: `Output destination`, `Custom folder`, `Default book language`, `Open sidebar on startup`, `Consolidate: chapter files`, `Consolidate: images`. Hochformat — deshalb `detail` mit Vorschaubild. |

> **Warum `sidebar-book.png` und `reorder.gif` in der Klasse `detail` stehen** und nicht,
> wie zuerst entworfen, in `feature`: Beide zeigen das Panel, und das Panel ist schmal und
> hoch (gemessen 276 px breit). Auf 820 px Anzeigebreite gebracht ergibt das ein Bild mit
> H/B 2.6 bzw. 2.2 — der Bild-Standard begrenzt `feature` auf 1.6, und zu Recht: ein
> überhohes Bild in voller Breite schiebt den Text aus dem Blick. `detail` ist genau für
> diesen Fall da (380-px-Vorschau, verlinkt auf die Vollauflösung). Die Klasse folgt der
> Form des Motivs, nicht der Wichtigkeit der Aussage.

> **Warum `Alt+↓` und nicht die Ziehgeste**, obwohl das Ziehen die auffälligere Bedienung
> ist: Die Liste benutzt echtes HTML5-Drag-and-Drop (`li.draggable = true`, `dragstart` →
> `drop`, `sidebar-render.ts:77,96,119`), und synthetische Mausereignisse lösen das in
> Chromium **nicht** aus — ein per `Input.dispatchMouseEvent` „gezogenes" Kapitel bewegt
> sich nicht, der Lauf meldet aber Erfolg und schreibt ein GIF, auf dem nichts passiert.
> `Alt+↓` ist dieselbe Funktion über den zweiten, gleichwertigen Weg: eine echte,
> dokumentierte Bedienung (`view.dragHint` nennt beide), die deterministisch auslösbar ist.
> Die Bildunterschrift in der README nennt trotzdem beide Wege.

### Nicht aufnehmbar: das Ordner-Kontextmenü (Stand 2026-08-30)

`folder-menu.png` stand im ersten Entwurf dieses Vertrags und ist wieder herausgenommen.
**Obsidians Kontextmenü lässt sich von außen nicht öffnen** — vier Wege gemessen, alle
scheitern lautlos (kein Fehler, kein Menü):

| Weg | Ergebnis |
|---|---|
| `dispatchEvent(new MouseEvent("contextmenu"))` auf `.nav-folder-title` | kein `.menu` im DOM |
| Echter Rechtsklick über `Input.dispatchMouseEvent` (`mousePressed`/`mouseReleased`, `button: "right"`), mit `mouseMoved` davor und Fokus geprüft (`document.hasFocus() === true`) | kein `.menu` |
| `new Menu()` + `app.workspace.trigger("file-menu", …)` | `require("obsidian")` ist im Renderer **nicht auflösbar** (`Cannot find module 'obsidian'`) — dieselbe Falle, die `calendar-notes` am 2026-08-29 traf |
| `fileExplorerView.onFileContextMenu(evt, file)` direkt aufgerufen | läuft ohne Fehler durch, zeigt aber nichts — der Handler verlangt vermutlich ein echtes (`isTrusted`) Ereignis |

Der Ordner **war** dabei sichtbar und korrekt getroffen (`.nav-folder-title[data-path="Chapters"]`,
Box 276×25 bei x=56, y=116), das Fenster hatte Fokus. Es liegt also nicht am Zielelement.

**Warum das hier steht, statt das Bild still wegzulassen:** Das Kontextmenü ist ein häufiges
Motiv — mehrere Plugins in diesem Workspace dokumentieren Einstiegspunkte darüber. Wer es
das nächste Mal versucht, soll diese vier Wege nicht noch einmal durchlaufen. Führt jemand
einen fünften Weg ein (naheliegend: ein echter Rechtsklick auf **Betriebssystemebene**
statt über CDP), gehört er hier ergänzt und das Bild zurück in den Vertrag.

Der Punkt, den das Bild belegen sollte — *der Einstiegspunkt bestimmt den Modus* — steht
weiterhin als Text in beiden READMEs unter „Ways into an export" / „Wege in den Export".

**Nicht im Vertrag, bewusst:** ein Bild des fertigen EPUB in einem Lesegerät. Es wäre das
überzeugendste Bild des Plugins und ist **mit diesem Treiber nicht aufnehmbar** — es
entsteht außerhalb von Obsidian, und der Treiber fährt ausschließlich gegen Obsidian.
Wird es gewünscht, ist es eine Handaufnahme mit eigenem Reproduktionsweg; dann gehört es
mit dieser Einschränkung hier eingetragen, statt stillschweigend zu fehlen.

## UI-Strings, verbatim aus `src/i18n/strings.ts`

Damit die Bildinhalte prüfbar sind, ohne den Prüfling zu raten. Englische Fassung, weil
`README.md` die kanonische ist. **Ändern sich diese Strings, ändern sich die Bilder** —
das ist der Anlass, an dem eine Aufnahme fällig wird.

| Schlüssel | Text |
|---|---|
| `view.title` | EPUB Exporter |
| `view.context.book` | Book note |
| `view.context.note` | Note |
| `view.chaptersLabel` | Chapters |
| `view.dragHint` | Drag to reorder · Alt+↑/↓ |
| `view.export` | Export as EPUB |
| `view.editMetadata` | Edit metadata |
| `view.consolidate` | Consolidate to folder |
| `view.makeBook` | Make into a book |
| `modal.consolidate.title` | Consolidate to folder |
| `modal.consolidate.summary` | Folder “{0}” · {1} chapter(s) |
| `modal.consolidate.confirm` | Consolidate |
| `cmd.exportFolder` | Export folder as EPUB |
| `cmd.importFolder` | Import folder as book |
| `settings.output.name` | Output destination |
| `settings.customFolder.name` | Custom folder |
| `settings.language.name` | Default book language |
| `settings.openSidebar.name` | Open sidebar on startup |
| `settings.consolidateChapter.name` | Consolidate: chapter files |
| `settings.consolidateAsset.name` | Consolidate: images |

## Reproduktion

```bash
npm run build && npm run shots -- --setup   # Vault aus dem Fixture bauen
#   ... Aufnahme-Vault öffnen (siehe unten), einmalig als vertrauenswürdig markieren
npm run shots                                # alles aufnehmen
npm run shots -- --only hero.png             # ein Bild nachziehen
npm run shots -- --list                      # diesen Vertrag anzeigen
npm run shots:check                          # gegen den Bild-Standard prüfen
```

### ⚠️ Obsidian ist Single-Instance — der Vault wird per IPC geöffnet, nicht per `open`

**Läuft bereits ein Obsidian, lässt sich kein zweiter Prozess mit eigenem Debug-Port
starten.** `open -a Obsidian --args --remote-debugging-port=9223` ignoriert die Argumente
und fokussiert nur das bestehende Fenster; `obsidian://open?path=…` tut es ebenfalls nicht.

Das ist keine Randnotiz, sondern der Normalfall in diesem Workspace: an derselben Maschine
arbeiten mehrere Sessions, und ein Nachbar-Plugin kann einen stundenlangen Indexlauf in
seinem Obsidian halten. **Ein `quit` vor der Aufnahme ist deshalb destruktiv** — es
vernichtet fremden Zustand, den kein Neustart zurückbringt. (Gemessen am 2026-08-30: ein
Reindex mit zwei Stunden Rechenzeit, dessen Fortschritt nur im Speicher stand.)

Der Weg, der stattdessen funktioniert:

1. **Läuft schon ein Obsidian mit `--remote-debugging-port=9222`?** Dann diesen Port
   mitbenutzen — und **vorher die Session fragen, der er gehört**.
2. Den Aufnahme-Vault in `obsidian.json` eintragen und mit
   `ipcRenderer.send("vault-open", <pfad>)` aus einem beliebigen Renderer öffnen. Das
   erzeugt ein **zweites Fenster im selben Prozess**, keinen zweiten Prozess.
3. Der Treiber wählt sein Fenster über `attachTo("workspace", 9222, "epub-exporter")` —
   der Vault-Name-Filter greift und trifft fremde Fenster nicht.
4. Läuft **gar kein** Obsidian, ist der klassische Weg zulässig:
   `open -a Obsidian --args --remote-debugging-port=9222`.

**Und:** `attachTo("settings", …)` filtert **nicht** nach Vault — für `settings` ist der
Vault-Filter per Kurzschluss abgeschaltet (`cdp.ts:466`), es gewinnt der erste Treffer. Aus
dem Renderer ist die Zuordnung auch nicht nachzuholen: das Einstellungen-Fenster trägt kein
`window.app`. Das Rezept wählt sein Fenster deshalb über die **Herkunft** — `/json/list` vor
und nach `app.setting.open()` vergleichen, das neu hinzugekommene Target ist unseres.

Ein Filter über den **Fenstertitel** wäre möglich (er trägt den Vault-Namen und steht schon
in `/json/list`); das Dach baut ihn gerade. Falls du ihn hier einsetzt: nur der Teilstring
`" - <vault> - Obsidian"` ist stabil. Das erste Wort ist lokalisiert und wechselt sogar
innerhalb einer Sitzung — dieses Rezept stellt die UI-Sprache auf Englisch um, danach standen
`Settings -` und `Einstellungen -` gleichzeitig in der Liste.

## Fallen, die dieser Prüfling teilt

Aus der REGISTRY-Zeile „README eines Plugins reproduzierbar bebildern" — alle gemessen,
alle von der Sorte *der Lauf meldet Erfolg, das Ergebnis ist wertlos*:

- **`openNote` überschreibt die Zieldatei** mit dem übergebenen Body. Für vorhandene
  Fixture-Notizen `openExisting` nehmen — sonst stehen die Kapitel hinterher auf 0 Bytes,
  und ausgerechnet dieses Plugin lebt von seinen Kapiteln.
- **Geschlossene Blätter bleiben im DOM.** `querySelector` trifft dann ein 0×0-Element und
  jedes Warten läuft in seinen Timeout. Immer nur den **ersten sichtbaren** Treffer nehmen.
- **`detachLeavesOfType("markdown")` hinterlässt einen Workspace, in dem das nächste Blatt
  nicht mehr rendert** — Datei aktiv, Blatt da, Lesefläche leer, nichts in der Konsole.
  Neuaufbau über einen Notizwechsel.
- **Das Layout ist persistent.** Abräumen wirkt nur auf Container-Ebene
  (`rootSplit.children`); `detachLeavesOfType` und `workspace:close-others` melden Erfolg
  und tun nichts. `--setup` löscht `workspace.json`.
- **Plugin-Einstellungen überleben in `data.json`** — ein früherer Lauf wirkt sonst nach.
  Für dieses Plugin besonders relevant: `outputTarget` und die beiden `consolidate*`-Werte
  bestimmen, was `consolidate-modal.png` überhaupt zeigt.
- **Fenstergröße:** `Emulation.setDeviceMetricsOverride` staucht die Seite ins echte
  Fenster, statt es zu vergrößern. Für Electron ist
  `electron.remote.getCurrentWindow().setSize()` der richtige Hebel.
- **App-Einstellungen greifen zur Laufzeit nicht über `.obsidian/app.json`**, sondern über
  `app.vault.setConfig`. Betrifft hier vor allem `showInlineTitle: false` — sonst doppelt
  der Inline-Titel die H1 der Buch-Notiz in `hero.png`.
- **Live Preview bleibt nach einem Split-Bild abgeschaltet.** Jeder Shot stellt seine
  Voraussetzungen selbst her — für `hero.png` heißt das: Lesemodus ausdrücklich setzen.

**Die Regel, die alles andere billiger macht:** nach jedem Lauf ein Bild des **ganzen
Fensters** ansehen, nicht nur die Messwerte lesen. Und vor dem Committen die Maße prüfen —
ein misslungener Lauf hinterlässt schlechtere Bilder an derselben Stelle, ohne dass etwas
fehlschlägt.

## Fixture

`fixture/` hält den Aufnahme-Vault als **Generator plus Inhalte**, nicht als Datenblob:
`notes/` (die Buch-Notiz und ihre Kapitel) und `obsidian/` (Vault-Konfiguration, die
**nur dieses Plugin** aktiviert — in einem gemeinsamen Vault malen fremde Ribbon-Icons in
jedes Bild).

Die Beispielinhalte sind **generisch und englisch**: kein echter Name, keine Firma, keine
Adresse. Sie sind gemeinfreier Stoff, damit das Buch wie ein Buch aussieht und trotzdem
niemandem gehört.
