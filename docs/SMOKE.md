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

### Titelbild erzeugen (Nachbarplugin-Kopplung)

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **T1** | Ohne `local-image-generator` im Plugin-Register erscheint `.epub-sb-action-cover` **nicht** | Der Realzustand dieses Vaults, und der Fall, der im Alltag bricht: das Nachbarplugin ist optional und lässt sich zur Laufzeit abschalten. Ein Knopf, der erscheint und dann nichts kann, ist schlimmer als keiner |
| **T2** | Mit einem eingesetzten Provider-**Stub** erscheint der Knopf, ein Klick (200 ms Haltedauer) öffnet `.epub-cover-modal`, und das Prompt-Feld nennt den **Buchtitel** | Prüft unsere Erkennung (Version **und** Form) und die Vorbelegung aus den Metadaten der Notiz. Wäre nur „Dialog geht auf" gemessen, bliebe eine leere Vorbelegung unsichtbar |
| **T3** | Nach „Erzeugen" liegt die PNG-Datei **im Vault**, `cover:` zeigt darauf, und der eingegebene Text steht als `cover_prompt:` in der Notiz | Die ganze Naht in einem Punkt — und er wartet am **Dateisystem**, nicht am schließenden Dialog: ein Punkt, der nur dessen Verschwinden sieht, wäre auch dann grün, wenn nichts geschrieben wurde |

**Warum ein Stub und kein echter Lauf:** die Bilderzeugung gehört dem Nachbarplugin und setzt
es installiert voraus — kein Treiber soll an eine fremde Installation gebunden sein. Was **hier**
falsch sein kann, ist unsere Seite — Erkennung, Sichtbarkeit, die Reihenfolge von Datei und
Notiz. Genau die misst der Stub, gegen echtes DOM und einen echten Vault. Er wird nach jedem
Punkt wieder entfernt: ein liegengebliebener Stub ließe **T1** grün aussehen, während er seinen
Gegenstand nicht mehr berührt.

> Hier stand bis 2026-09-02 zusätzlich „braucht eine GPU und dauert im eingebauten Modus
> Minuten". Die erste Hälfte stimmt, die zweite ist gemessen falsch: ein echter builtin-Lauf
> (sd-turbo, 4 Steps) dauert mit warmem Modell **6–7 Sekunden**. Die teure Annahme hatte den
> echten Lauf länger verhindert, als er gekostet hätte.

**Was der Stub per Konstruktion nicht sehen kann, misst `npm run smoke:e2e`** (§ Ende-zu-Ende).
T1–T3 bleiben, wie sie sind: sie sind die Hälfte, die in **jeden** Durchgang gehört.

### Aufräumen

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **C1** | Nach dem Lauf ist die Buch-Note **byte-gleich** zum Vorwert, und die erzeugten Dateien liegen im Papierkorb | Der Treiber verändert die SSOT (R1–R3 schreiben in den Spine). Was er zurückschreibt, gehört ins Protokoll — nicht ins Vertrauen |

## Ende-zu-Ende über die Plugin-Grenze (`npm run smoke:e2e`)

**Wo zwei Repos je ihre Hälfte prüfen, prüft niemand die Naht.** Unsere Punkte T1–T3 fahren
gegen einen Stub, der Smoke des Nachbarn ruft seine eigene API selbst auf — beides je für sich
richtig, und beide überspringen genau die Verbindung. Der Befund steht seit `llm-lab` 0.3.0 in
der REGISTRY; dieser Lauf ist seine Anwendung auf dieses Repo.

```bash
npm run build
npm run smoke:e2e -- --setup   # Staging-Vault + BEIDE Plugins deployen
npm run smoke:e2e              # 9 Punkte, Sekunden
npm run smoke:e2e -- --gpu     # zusätzlich G1: echte Diffusion, ohne jeden Ersatz
```

Er ist **kein Teil von `gate` und nicht von `smoke:gui`**: er setzt voraus, was die anderen
ausdrücklich nicht voraussetzen — `local-image-generator` echt installiert im selben Vault,
aus dem Nachbar-Repo deployt (nicht aus dem Store: geprüft wird die Naht zum aktuellen Stand).

**Was echt ist und was nicht.** Echt sind das installierte Nachbarplugin, sein `api`-Objekt,
unsere Erkennung, jeder Aufruf über die Grenze, die zurückgereichten Bytes, unsere
Schreibreihenfolge. Ersetzt ist **nur das Rechnen dahinter** (`scripts/mock-a1111.mjs` aus dem
Nachbar-Repo, vom Treiber selbst gestartet). Der Mock sitzt **hinter** dem Nachbarplugin, nicht
zwischen ihm und uns — die Naht ist vollständig im Spiel. Wer auch das nicht ersetzt haben
will, fährt `--gpu`.

| # | Prüfpunkt | Was nur er sehen kann |
|---|---|---|
| **N1** | Das echt installierte Plugin meldet `apiVersion 1` in vollständiger Form, und unser Knopf erscheint | Der Stub bestätigt nur, dass wir *unsere* Erwartung erfüllen. Ob der Nachbar sie erfüllt, sagt allein das geladene Objekt |
| **N2** | Endpunkt tot → `unreachable`; Server läuft wieder → `status()` merkt es **nicht**, `recheck()` schon — **und der Dialog geht daraufhin auf** | Der Grund, warum `ensureImageApiReady` existiert. Der Stub meldet immer `ready`, also lief dieser Zweig nie. Die zweite Hälfte (unser Klick) macht ihn erst zum Naht-Punkt |
| **N3** | Voller Weg über die Oberfläche: die Datei im Vault trägt **byte-gleich** die Base64-Daten, die der Anbieter zurückgab; `cover:`/`cover_prompt:` zeigen darauf | Der Stub liefert ein 1×1-PNG, das wir selbst hineingelegt haben — er kann nicht belegen, dass fremde Bytes unverfälscht ankommen |
| **N4** | Der `onProgress`, den wir mitgeben, wird vom echten Anbieter gerufen | Ob unser Dialog während des Rechnens stumm bleibt, entscheidet der Nachbar, nicht wir |
| **N5** | Backend auf HTTP 500 → `{ ok: false, reason: "failed", message }` als **Wert**, der Dialog zeigt ihn und gibt den Knopf frei; nichts wird geschrieben | Dass erwartbare Zustände Werte statt Ausnahmen sind, ist eine Vertragszusage. Ein Stub, der immer `ok` liefert, prüft sie nie |
| **N6** | Im builtin-Modus meldet der Anbieter **genau eine** Größe (512×512) | Unser `coverSizeOptions` ist darauf gebaut. Der Stub meldet `sizes: null` (Server-Modus) — die Annahme war ungeprüft |
| **N7** | …und der Dialog zeigt dann **kein** Auswahlfeld | Die Verzweigung, die der Stub per Konstruktion nie erreicht. Ein Dropdown mit einem Eintrag wäre eine Attrappe |
| **N8** | Nicht bereit (`not-configured`) → **kein** Dialog, eine Meldung, nichts geschrieben | Readiness wird *vor* dem Dialog aufgelöst; jemanden erst einen Prompt tippen zu lassen wäre die schlechteste Stelle dafür. Gegen den Stub unerreichbar |
| **G1** | `--gpu`: builtin-Engine rechnet wirklich, `loading-model` **und** `generating` kommen an, 512×512 wird angefragt | Der Lauf, in dem nichts mehr ersetzt ist. Braucht die Modell-Assets — die liegen im Cache Storage des Obsidian-**Profils**, nicht im Vault, und `--setup` kann sie nicht herstellen |
| **N9** | Der Spy ist zurückgebaut | Ein stehengebliebener Wrapper verfälscht still jeden späteren Lauf im selben Fenster — und weil der Konsument Fehler wegfängt, sähe das wie ein Produktfehler aus |

**Der Spy wrappt und reicht durch**, bis in den Callback hinein. Ein Spy, der *ersetzt*, prüft
wieder nur die eigene Hälfte; einer, der `onProgress` austauscht statt umhüllt, nimmt der
Oberfläche genau das Signal weg, das N4 messen soll.

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

### Ende-zu-Ende (`smoke:e2e`)

| Datum | Obsidian | epub-exporter | Nachbar | Ergebnis | Gegenproben |
|---|---|---|---|---|---|
| 2026-09-02 | 1.13.7 | 0.4.0 (deployt) | LIG 0.11.0 (deployt) | **10/10** (mit `--gpu`) | ✅ drei, jede einzeln gültig — `recheck()`-Zweig aus `ensureImageApiReady` ausgebaut → nur **N2** rot; `sizes.length > 1` zu `>= 1` aufgeweicht → nur **N7** rot; Readiness-Vorprüfung in `main.ts` ausgebaut → nur **N8** rot |

Nebenbefund des ersten Laufs, der einen Prüfpunkt gehärtet hat: die Gegenprobe zu N7 meldete
**zwei** Auswahlfelder, wo höchstens eines entstehen kann. Der Punkt las mit
`querySelector(".epub-cover-modal")` einen von womöglich mehreren Dialogen im DOM und
summierte darüber. Er zählt die Dialoge jetzt mit und wird rot, wenn es nicht genau einer ist
— ein Prüfpunkt, dessen Ergebnis von Resten eines früheren Punktes abhängt, misst nicht, was
er behauptet.
