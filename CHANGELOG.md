# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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
