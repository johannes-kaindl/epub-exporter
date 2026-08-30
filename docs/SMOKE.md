# GUI-Smoke — epub-exporter

Prüfung gegen ein **laufendes** Obsidian. Die vitest-Suite deckt die Rechenlogik ab —
Spine-Parser, ZIP-Writer, `dom-to-xhtml` gegen einen Fake-DOM. Was sie nicht sieht, ist die
Naht zum Host: dass **Obsidian selbst** das Markdown rendert, dass der Sidebar-Leaf seinen
Lebenszyklus überlebt, dass ein Klick beim ersten Mal wirkt. Genau dort lagen die bisher
teuersten Defekte dieses Plugins (CORE-TEST-02).

**Automatisiert seit 2026-08-30** — `npm run smoke:gui`. Von Hand abzuhaken ist hier nichts
mehr; die Beschreibungen bleiben stehen, weil sie begruenden, was jeder Punkt prueft.

## Vorbereitung

```bash
npm run build
npm run smoke:gui -- --setup          # Staging-Vault aus dem Fixture herstellen
npm run smoke:gui -- --vault epub-exporter
```

Der Lauf misst im **eigenen Staging-Vault** (`$STAGING_VAULTS_DIR/epub-exporter`), nicht im
Arbeitsvault. Grund ist nicht Ordnung, sondern Gültigkeit: im Arbeitsvault läuft der
Store-Build statt des Repo-Stands, und `manifest.version` ist blind dafür — beide tragen
dieselbe Nummer. Das Prüfmaterial ist das getrackte Fixture unter `docs/images/fixture/`
(dasselbe, aus dem die README-Bilder entstehen); was darüber hinaus gebraucht wird, legt der
Treiber deterministisch selbst an und räumt es in den Papierkorb.

> [!warning] Obsidian ist Single-Instance — niemals blind beenden
> Läuft schon eines mit offenem Debug-Port, wird der Port **mitgenutzt**: eigenes Fenster per
> `vault-open` über IPC, dann Anhängen über den Vault-**Namen**, nicht über die Reihenfolge.
> Ein Beenden trifft die Instanz, an der andere Sessions arbeiten, und zerstört deren Zustand
> — der eigene Lauf ist danach sauber grün, der Schaden entsteht woanders. Seit 2026-08-30
> regelt das ein Lock (`~/.claude/hooks/obsidian-cdp-lock.py`), nicht mehr die Absprache
> allein: vor dem Zugriff `acquire`, danach `release`.

## Prüfpunkte

Jeder Punkt misst den **Effekt**, nicht die Ursache, und steigt über einen plugin-eigenen
Anker (`.epub-sb-…`) ein — nie über eine nackte Obsidian-Klasse. Der Grund steht in der
Fallen-Tabelle des Skills: `.view-action` trifft Obsidians eigenen Knopf, `.notice` den
globalen Toast, in den jedes Plugin im Vault schreibt.

### Sidebar-Lebenszyklus

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **S1** | Command `open-sidebar` öffnet einen Leaf vom Typ `epub-exporter-hub`, und `.epub-exporter-sidebar` hat **Ausdehnung** (`getClientRects()`, Breite > 0) | Ein `querySelector` allein wird grün, während das Panel 0 px breit ist. Genau dieser Fehlschluss kostete am 2026-08-30 einen kompletten Aufnahme-Lauf |
| **S2** | Bei aktiver Buch-Note nennt `.epub-sb-subtitle` den Buchtitel, und `.epub-sb-chapters > li.epub-sb-chapter` sind **genau 5**, in Fixture-Reihenfolge | Der Spine wird aus den rohen Embeds gelesen; die Reihenfolge ist die Aussage |
| **S3** | Bei aktiver **Kapitel**-Note zeigt das Panel den **Einzelnoten**-Kontext: Untertitel = Kapitelname, kein Kapitel-Block, sichtbare Export-Aktion | Der Entry-Point bestimmt den Modus, nicht ein Setting. Wäre die Kontexterkennung tot, bliebe S2 stehen und niemand sähe es. ⚠️ Der erste Lauf erwartete hier den Empty-State und meldete korrektes Verhalten als Defekt — das Plugin kennt **drei** Kontexte (`book`/`note`/`none`), und eine offene Notiz ist nie `none` |
| **S6** | Ist **keine** Notiz offen, erscheint der Empty-State `.epub-sb-empty` sichtbar und mit Text | Der dritte Kontext, den S3 vorher faelschlich fuer sich beansprucht hat. Entstanden aus dem ersten Lauf |
| **S4** | **Ein einziger** Klick auf `.epub-sb-action-export` — mit **200 ms Haltedauer** — erzeugt die EPUB-Datei | Historischer Defekt `9c5d051`: ein redundanter Rerender bei `active-leaf-change` zerstörte den Button unter dem Cursor — Knöpfe brauchten zwei Klicks. Der Fix ist die Model-Key-Memoisierung. ⚠️ **Die Haltedauer ist der Prüfpunkt**, nicht Beiwerk: mit einem Klick ohne Pause bleibt er grün, während der Defekt aktiv ist (gemessen, siehe Gegenprobe) |
| **S5** | Das Ribbon-Icon **öffnet die Sidebar** und exportiert nicht | Historischer Defekt `2986c0b`: das Ribbon war auf den Export verdrahtet. Ein Prüfpunkt, der nur „irgendetwas passierte" misst, wäre in beiden Fällen grün |

### Umsortieren

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **R1** | `Alt+↓` auf Kapitel 1 vertauscht Kapitel 1 und 2 **im Dateiinhalt** der Buch-Note | Am DOM gemessen wäre der Punkt grün, während die Datei unverändert bleibt. Die Datei ist die SSOT, nicht die Anzeige |
| **R2** | Ein **zweites** `Alt+↓` bewegt dasselbe Kapitel weiter (1→2→3), hebt sich nicht auf | Historischer Defekt: ein stale `focusIndex` ließ die zweite Geste auf das alte Element zeigen — wiederholtes `Alt+↓` pendelte |
| **R3** | Ein Embed mit Alias (`![[Datei\|Anzeigename]]`) überlebt den Reorder wörtlich | `reorderSpine` permutiert **rohe** Zeilen, statt sie zu regenerieren — genau damit Alias und Heading strukturell überleben. Ein regenerierender Fix wäre an S2/R1 unsichtbar |

### Export-Naht (Engine gegen echtes Obsidian)

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **E1** | Die erzeugte Datei beginnt mit `PK\x03\x04`, ihr **erstes** Entry heißt `mimetype`, ist **unkomprimiert** gespeichert und enthält `application/epub+zip` | Die EPUB-Spezifikation verlangt genau das, und es ist die eine Eigenschaft, die ein `fflate`-Round-Trip im Unit-Test **nicht** prüft: der Round-Trip ist mit jeder Kompression zufrieden |
| **E2** | Das Archiv enthält 5 Kapitel-XHTML-Dateien | Belegt, dass der Spine bis ins Paket durchschlägt — nicht nur bis in die Anzeige |
| **E3** | Ein Kapitel mit Fenced Code liefert den Code **wörtlich** ins XHTML | Der Code-Block-Hijack-Guard ist die verletzlichste Stelle des Plugins: `MarkdownRenderer.render` führt alle Prozessoren fremder Plugins aus, `<pre>` wird durch Widget-DOM ersetzt, Originalcode ist dann nicht rekonstruierbar. Gegen einen Mock ist dieser Pfad **prinzipiell** nicht prüfbar |

### Aufräumen

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **C1** | Nach dem Lauf ist die Buch-Note **byte-gleich** zum Vorwert, und die erzeugten Dateien liegen im Papierkorb | Der Treiber verändert die SSOT (R1–R3 schreiben in den Spine). Was er zurückschreibt, gehört ins Protokoll — nicht ins Vertrauen |

## Nicht automatisiert

- **Optik und Anmutung** („sieht gut aus", „fühlt sich flüssig an") — bleibt Hand-Runde.
- **Drag-and-drop mit der Maus.** `Alt+↑/↓` und Ziehen sind zwei Wege zu **einer** Wirkung
  (`reorderSpine`); R1–R3 messen die Wirkung. Eine echte HTML5-Drag-Sequenz nachzustellen
  prüfte den Browser, nicht das Plugin.
- **Das Ordner-Kontextmenü** („Ordner als Buch importieren"). Mit vier gemessenen Wegen nicht
  ansteuerbar — siehe `docs/images/README.md`. Bleibt Handarbeit.
- **Fremde Code-Block-Plugins.** E3 prüft den Guard gegen Obsidians eigenen Renderer; ob ein
  konkretes Fremd-Plugin ihn aushebelt, zeigt nur ein Vault, in dem es installiert ist.

## Was die Gegenprobe gelehrt hat (2026-08-30)

**Ein grüner Smoke beweist nichts, solange er nie rot war** — und der erste Versuch einer
Gegenprobe blieb hier **12/12 grün, obwohl der Fix ausgebaut war**. S4 hatte seinen
Gegenstand nie berührt.

Ursache war nicht der Prüfpunkt, sondern die zentrale Brücke: `clickReal` schickte
`mousePressed` und `mouseReleased` **ohne Pause**. Das ist schneller als der asynchrone
Rerender (`await bridge.snapshot()` ist echtes I/O), also überlebte der Knopf einen Klick,
den er im Gebrauch nicht überlebt. Nachgemessen bei ausgebautem Fix:

| Haltedauer | Knopf lebt bei `mouseup` | Export ausgelöst |
|---|---|---|
| 0 ms | ja | **ja** — Punkt grün trotz aktivem Defekt |
| 150 ms | nein | nein |
| 400 ms | nein | nein |

`clickReal` hat deshalb seit `obsidian-plugins`/2026-08-30 einen dritten Parameter
`haltenMs` (Default 0, rückwärtskompatibel). **Wer einen Knopf prüft, dessen Ansicht sich
selbst neu zeichnet, setzt ihn.** Die Verallgemeinerung, die über diesen Fall hinausgeht:
ein Treiber, der eine Eingabe *schneller* ausführt, als ein Mensch sie ausführen kann, misst
einen Pfad, den es im Gebrauch nicht gibt.

## Durchläufe

| Datum | Obsidian | Plugin | Ergebnis | Gegenprobe |
|---|---|---|---|---|
| 2026-08-30 | 1.13.7 | 0.3.1 (deployt) | **12/12** | ✅ gültig: Memoisierung (`hub-view.ts:161`) ausgebaut → **11/12**, genau S4 rot, kein anderer Punkt mitgefallen |
