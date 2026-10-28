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
npm run smoke:gui -- --setup --port <port>   # Staging-Vault aus dem Fixture herstellen
npm run smoke:gui -- --port <port>           # Lauf in der Zweitinstanz
# mit --only <id> ist die Soll-Liste der Teillauf (C0, der Punkt, C1)
```

Der Lauf misst im **eigenen Staging-Vault** (`$STAGING_VAULTS_DIR/epub-exporter`), nicht im
Arbeitsvault. Grund ist nicht Ordnung, sondern Gültigkeit: im Arbeitsvault läuft der
Store-Build statt des Repo-Stands, und `manifest.version` ist blind dafür — beide tragen
dieselbe Nummer. Das Prüfmaterial ist das getrackte Fixture unter `docs/images/fixture/`
(dasselbe, aus dem die README-Bilder entstehen); was darüber hinaus gebraucht wird, legt der
Treiber deterministisch selbst an und räumt es in den Papierkorb.

> [!warning] Zweitinstanz mit eigenem Profil und Port — niemals die reguläre Instanz beenden
> Der Lauf geht in eine eigene Instanz: Profil `/tmp/obs-test-epub-exporter` (aktuelle `obsidian-*.asar` hineinkopieren, Vault und `"language":"en"` in `obsidian.json` eintragen), `--user-data-dir` und `--remote-debugging-port=<port>` setzen, vorher `lsof -nP -iTCP:<port> -sTCP:LISTEN` prüfen. `--port` ist Pflicht; ohne ihn bricht der Treiber mit Exit 2 ab, statt auf die reguläre Instanz (9222) zu greifen. Vertrauensdialog und Restricted Mode erledigt `bereiteInstanzVor` aus der zentralen Brücke. Ein Quit der regulären Instanz trifft die Sessions, die daran hängen. Vor dem Zugriff gilt der Lock für den eigenen Port (`~/.claude/hooks/obsidian-cdp-lock.py acquire … --port <port>`), danach `release`.
>
> Die Bilanz hat vier Zustände (CORE-TEST-19): grün · rot · übersprungen · nichts gemessen. Die Soll-Liste `PUNKTE` ist der Nenner, ein nie aufgezeichneter Punkt zählt als „nichts gemessen“ und setzt Exit 1; ein Abbruch ist Exit 2. C0 (Rest-Stub) und C1 (Buch-Notiz nach dem Lauf byte-gleich) zählen mit.

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
| **S6** | Ist **keine** Notiz offen, erscheint der Empty-State `.epub-sb-empty` sichtbar und mit Text, darunter ein zweites Element `.epub-sb-empty-hint` (sichtbar), das den Befehl „Insert book frontmatter into note“ so nennt, wie das Befehlsregister ihn führt | Der dritte Kontext, den S3 vorher faelschlich fuer sich beansprucht hat. Entstanden aus dem ersten Lauf. Der Befehlsname wird zur Laufzeit aus `app.commands` gelesen, nicht aus dem Quelltext: nur so fällt Drift zwischen Satz und Befehl auf, und ein leerer Name zählt als „nicht gefunden“, nie als Treffer |
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
| **T1** | Ohne `local-image-generator` im Plugin-Register erscheint `.epub-sb-action-cover` **nicht** — der Zustand wird **hergestellt** (`disablePlugin` + danach zurück), nicht vorausgesetzt | Der Fall, der im Alltag bricht: das Nachbarplugin ist optional und lässt sich zur Laufzeit abschalten. Ein Knopf, der erscheint und dann nichts kann, ist schlimmer als keiner |
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

### Buch-Frontmatter einfügen

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **F1** | „Insert book frontmatter into note“ auf einer Wegwerf-Notiz mit eigenem Block (`title`, eine Flow-Liste `foo: [a, b]`, ein Kommentar `# Hinweis`) ergänzt die 13 Vorlagenfelder **hinter** den eigenen Zeilen, die byte-gleich bleiben; `epub` steht als Boolean `true`, `title` genau einmal, Obsidians Metadaten-Cache liest `epub === true` und `foo` als Liste, und ein **zweiter** Lauf ändert die Datei nicht; die Meldung des ersten Laufs ist „Book frontmatter added.“, die des zweiten „Book frontmatter is already complete.“ (englische Oberfläche, die erste steht dann nicht mehr da) | Bis 0.7.0 lief der Befehl über `processFrontMatter`, das den ganzen Block neu schreibt: aus `foo: [a, b]` wurde eine Blockliste, der Kommentar ging verloren (gemessen 2026-10-25). Der Punkt prüft zuerst die Datei: die Meldung „ergänzt“ stand früher auch dann da, wenn der Block zerlegt war oder nichts zu ergänzen war (bis 0.8.0 bei jedem Lauf); seit der Unterscheidung prüft er die Meldung zusätzlich. Gegenprobe: der alte Weg macht ihn rot |

### Ordnermodus (Ordner als Buch)

Alle fünf Punkte arbeiten an einem Wegwerf-Baum unter `_smoke-ordner/` (zwei `README.md`, ein Name ohne Überschrift, ausgeblendeter Ordner `0 - Entwurf` und Seite `000_Notiz`, ein Teilbaum mit Tiefe 3, ein Bild) und räumen ihn samt `_smoke-arbeit/` in den Papierkorb; jeder Punkt stellt den Baum und die Einstellungen selbst her, damit `--only` dasselbe misst wie der Gesamtlauf. Der Rechtsklick ist ein echter Mausklick mit der rechten Taste auf den Ordner im Datei-Explorer. Unter macOS zeichnet Obsidian Menüs nativ (kein `.menu` im DOM), deshalb stellt der Treiber `nativeMenus` im Wegwerf-Vault vor dem Klick aus und danach zurück.

| # | Prüfpunkt | Warum er existiert |
|---|---|---|
| **O1** | Das Ordner-Menü führt **genau einen** EPUB-Eintrag, „Create EPUB“ (mit Icon), und keinen der früheren („Export folder as book“, „Import folder as book note“); der Klick zeigt die Ordner-Vorschau mit den **11 erwarteten Zeilen** (Tiefe, Titel, Ordner/Seite von Hand aus der Regel gelesen) und „2 hidden“. Die Icons `folder`, `file-text`, `eye-off` und `x` sind **gezeichnet** (ein `svg` in der Klasse `lucide-…`), der Schließen-Knopf ist ein `BUTTON` mit `aria-label`, liegt in der Kopfzeile neben dem Titel, nimmt Fokus an und zeigt nach einer Tastengeste einen Fokusring; die Einrückung kommt aus `data-depth` ohne `style`-Attribut und bleibt ab Tiefe 6 stehen (Baum mit 9 Ebenen); ein echter Klick auf × beendet den Ordnermodus | Die Fake-Tests belegen nur `data-icon`, nicht ob Obsidian den Namen zeichnet (UI-STANDARD § 8). Die Kontrolle zeichnet denselben Weg mit einem erfundenen Icon-Namen und erwartet ein leeres Element, sonst taugt die Messung nicht. Gemessen 2026-10-28, Obsidian 1.15.0: `folder` wird als `lucide-folder-open` gezeichnet, der Name stimmt, die Messung prüft deshalb das Präfix `lucide-folder` |
| **O2** | Das Umbenennen einer Datei im Baum ändert die Vorschau (neuer Titel da, alter weg); danach genügt **ein** Klick (200 ms Haltedauer) auf „Export as EPUB“, und das EPUB trägt den neuen Titel. Wird der **Ordner selbst** umbenannt, bleibt die Sidebar im Ordnermodus auf dem neuen Pfad (Untertitel, 11 Zeilen), und beim Zurückbenennen folgt sie wieder | Der Alltag ist das Umbenennen im Explorer (Design § 5.8). Ohne das `rename`-Ereignis fiel die Sidebar still auf die aktive Notiz zurück |
| **O3** | Das exportierte ZIP: `nav.xhtml` hat die erwarteten 11 Einträge in der erwarteten **Verschachtelung** (Tiefen 0 bis 3), `toc.ncx` dieselben Tiefen mit `playOrder` 1 bis 11 ohne Lücke; `0 - Entwurf` und `000_Notiz` fehlen im Verzeichnis **und** in allen Kapiteln; die Einleitungsseite der Wurzel ist `chapter-01.xhtml` und der erste Eintrag; ein Kapitel ohne Einleitungsseite führt auf seine erste Seite; der Link `README.md` auf einer Seite von `01 - Anfang` zeigt auf **deren** `README`, der in `02 - Vertiefung` auf die dortige, `../README.md#start` auf die Wurzel, ein Link aus dem Buch heraus ist Text | Gegenprobe im Aufbau: Beide `README.md` liegen in verschiedenen Kapiteln, und der alte Weg (Dateiname, zuletzt eingetragene Seite) hätte für den Link auf der Anfang-Seite die README von `02 - Vertiefung` gewählt; der Punkt prüft vorher, dass das so ist, und wird mit dem alten Weg rot (gemessen) |
| **O4** | Arbeitskopie: der Zustands-Knopf nennt den Ist-Zustand im Text („Working copy: on/off“), `aria-pressed` folgt und „Create working copy“ gibt es nur bei „an“; ein **Abbruch mitten im Kopieren** (der dritte `vault.copy`-Aufruf wirft) hinterlässt **kein Ziel**, aber den Hilfsordner, meldet den Fehler und bietet „Create working copy“ wieder an; der **zweite Versuch** legt Baum und Bild vollständig an und der Hilfsordner ist weg; eine vorhandene Kopie bleibt unberührt (geänderte und eigene Seite überleben einen weiteren Aufruf, Meldung „left as it is“); Vorschau und Export lesen die Kopie, und das EPUB liegt **neben der Kopie**; mit dem Arbeitsverzeichnis **im** Ordner nennt die Sidebar den Grund statt des Schalters | Der Abbruch ist der Fall, den der Fake-Port nicht ersetzt: ob `vault.rename` auf einen Ordner und `fileManager.trashFile` im echten Vault laufen. Der Eingriff an `vault.copy` ist eine Eigenschaft am Vault-Objekt, die mit `delete` zurückgenommen wird; danach gilt die Methode des Prototyps, und das wird gelesen |
| **O5** | Gemessen am gerenderten DOM der Leseansicht: `data-href` eines relativen Markdown-Links `[x](../x.md#a)` ist der **Rohtext** `../x.md#a`; die Kontrolle am Wikilink `[[x\|Alias]]` zeigt `x`, also eine andere Form | Davon hängt die Linkauflösung ab (Plan Aufgabe 4). Gemessen 2026-10-28, Obsidian 1.15.0: gleich dem Rohtext; ein Link mit `%20` kommt dekodiert (`../my page.md`), die Auflösung nimmt beide Formen. Gemessen wird die Leseansicht, `MarkdownRenderer.render` ist von außen nicht aufrufbar; O3 prüft das Ergebnis des echten Exports |

Die Gegenproben (Mutation am Plugin, Bau, Lauf, Rückbau und Abschlusslauf) sind für O1 bis O5 gefahren worden: ein zweiter Menü-Eintrag, ein erfundener Icon-Name, fehlender Tiefen-Deckel, ohne `rename`-Ereignis in Sidebar und Plugin, der Namens-Weg für Links, Ausgeblendetes bleibt, Kopie ohne Hilfsordner, Überschreiben einer vorhandenen Kopie, Export aus dem Original, verkehrtes `aria-pressed`, verschobene Erwartung an `data-href`: jeder Punkt wurde rot, der Rückbau wieder grün.

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
| 2026-09-02 | 1.13.7 | 0.4.0 (deployt) | **15/15** | ✅ gültig: die T1-Härtung ausgebaut (`deaktiviereEchtenAnbieter`) → **14/15**, genau T1 rot. Belegt zugleich, dass die Gefahr real war: seit `smoke:e2e -- --setup` liegt `local-image-generator` echt im Staging-Vault, und T1 entfernte vorher nur seinen eigenen Stub |

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
