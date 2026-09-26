# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- **Hilfe-Zeile ganz oben in den Einstellungen** mit Knöpfen zur Dokumentation und zum Issue-Tracker (aus dem Kit 0.43.0 übernommen).

## [0.4.0] — 2026-09-02

### Hinzugefügt

- **Titelbilder lassen sich jetzt erzeugen, wenn das Plugin „Local Image Generator“
  installiert und aktiv ist.** Im Seitenpanel erscheint bei einer Buch-Notiz ein Knopf
  „Titelbild erzeugen“ (und ein gleichnamiger Befehl); ein Dialog fragt, was das Bild zeigen
  soll, und schlägt dafür etwas aus Titel und Autor vor. Das Ergebnis wird **als Datei neben
  der Buch-Notiz gespeichert** und `cover:` zeigt darauf — das Titelbild ist damit im
  Lesemodus sichtbar, bleibt über Exporte hinweg dasselbe und lässt sich jederzeit von Hand
  ersetzen. Die Beschreibung landet als `cover_prompt:` in der Notiz, damit der nächste Lauf
  davon ausgeht.

  Der Dialog bietet nur an, was der Bildgenerator wirklich kann: die Größenauswahl kommt aus
  seinen gemeldeten Fähigkeiten und entfällt, wo es nur eine Größe gibt. Fehlt das Plugin oder
  meldet es sich als nicht einsatzbereit, erscheint der Knopf gar nicht erst.


## [0.3.2] — 2026-08-30

### Geändert

- **Die Einstellung „Eigener Ordner“ verträgt jetzt getipptes Slash-Rauschen.** Sie ist ein
  freies Textfeld, und ihr Wert erreichte den Vault bisher nur um führende und schließende
  Slashes bereinigt. Backslashes werden jetzt zu `/`, wiederholte innere Slashes werden
  zusammengefasst — `Export\Bücher` und `Export//Bücher` ergeben beide `Export/Bücher`, also die
  Form, die Obsidians Vault-Adapter erwartet. Aus `obsidian-kit` 0.27.0 (`pure/vault-path.ts`).

## [0.3.1] — 2026-08-14

### Behoben

- Die Einstellungen sehen jetzt auf allen unterstützten Obsidian-Versionen gleich aus.
  Auf Versionen vor 1.13 blendete die Ausweich-Ansicht die Zeile „Eigener Ordner“ aus,
  solange das Ausgabeziel nicht bereits darauf stand — ab 1.13 war sie durchgehend
  sichtbar. Beide Ansichten lesen jetzt dieselbe Einstellungs-Definition.

### Geändert

- Die README ist jetzt englisch (`README.md`); die deutsche Fassung steht als
  `README.de.md` daneben.
- Die README dokumentiert erstmals die Frontmatter-Felder der Buch-Notiz samt ihrer
  deutschen Aliase (`titel`, `autor`, `sprache`, `verlag`, …) sowie die Funktionsweise
  des Exports. Die Beschreibung der Einstellungen war inhaltlich falsch — sie nannte
  Optionen für Bilder und Code-Blöcke, die es nicht gibt — und listet jetzt die
  tatsächlich vorhandenen Einstellungen mit ihren Vorgabewerten.

## [0.3.0] — 2026-07-24

### Hinzugefügt

- Kapitel lassen sich in der Sidebar per Ziehen oder `Alt+↑/↓` umsortieren; die neue
  Reihenfolge wird sofort in den Embed-Spine der Buch-Notiz geschrieben.
- Die Kapitelliste aktualisiert sich jetzt auch, wenn Embeds direkt in der offenen
  Buch-Notiz geändert werden.

## [0.2.0] — 2026-07-23

### Hinzugefügt

- **In Ordner konsolidieren:** Eine Buch-Note wird in einen self-contained Ordner
  überführt (Buch-Note + nummerierte Kapiteldateien + `_assets/`). Ein Bestätigungs-Dialog
  wählt, ob Kapitel kopiert oder verschoben werden und wie viele Bilder mitgenommen werden
  (alle · nur Cover · keine); die Vorgaben stehen in den Einstellungen. Erreichbar per Befehl,
  Sidebar-Button und Rechtsklick auf die Buch-Note.
- **Ordner als Buch importieren:** Aus einem Ordner mit Markdown-Dateien entsteht eine
  Buch-Note (Ordner-Note) mit nach Dateinamen sortiertem Embed-Spine — per Rechtsklick auf
  den Ordner, ohne die vorhandenen Dateien zu verändern.

## [0.1.1] — 2026-07-23

### Geändert

- Deklarative Settings-API (`getSettingDefinitions()`): Die Plugin-Einstellungen
  erscheinen ab Obsidian 1.13 in der Einstellungs-Suche. Die `display()`-Variante
  bleibt als Fallback für Obsidian < 1.13 erhalten.

## [0.1.0] — 2026-07-20

### Hinzugefügt

- Export einer Notiz als EPUB3 — mit Buch-Note als Single Source of Truth:
  Frontmatter trägt die Metadaten, geordnete `![[embeds]]` bilden den Kapitel-Spine.
- Sidebar als Hub-View: Buch-Übersicht, Kapitelliste, Export per Klick.
- Vier Ausgabeziele, Cover-Bild, interne Links, Bilder, Code-Blöcke.
- `chapter_title`-Override und `epub_exclude` pro Kapitel.
- Buchsprache Deutsch/Englisch, folgt der Obsidian-UI-Sprache.
- Abhängigkeitsfreie Engine: eigener store-only ZIP-Writer, eigene DOM→XHTML-Konvertierung.
