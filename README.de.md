# EPUB Exporter

Exportiert Notizen als EPUB3 — eine einzelne Notiz oder ein ganzes Buch aus eingebetteten Kapiteln.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://git.jkaindl.de/jkaindl/epub-exporter/src/branch/main/LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/epub-exporter?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/epub-exporter/releases)
[![Platform: Desktop + Mobile](https://img.shields.io/badge/Platform-Desktop%20%2B%20Mobile-blue.svg)](https://git.jkaindl.de/jkaindl/epub-exporter/src/branch/main/manifest.json)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](README.md).
> Bei Abweichungen gilt die englische Fassung.

## Features

- **Ein Buch ist eine Notiz.** Frontmatter trägt die Metadaten, die eingebetteten
  Kapitel bilden den Spine — keine separate Projektdatei, die aus dem Tritt gerät.
- Einzelne Notiz, Buch-Notiz oder ganzer **Ordner** als EPUB3 exportieren.
- **Seitenleiste** mit Kapitelliste; Umsortieren per Ziehen oder `Alt+↑/↓` schreibt
  die neue Reihenfolge direkt in den Embed-Spine der Buch-Notiz zurück.
- **Ordner als Buch importieren** und Buch-Notizen **in einen Ordner konsolidieren**
  (nummerierte Kapiteldateien + `_assets/`).
- Metadaten-Felder auf Deutsch oder Englisch (`autor`/`author`, `titelbild`/`cover`, …).
- Bilder, interne Links und Code-Blöcke wandern mit ins Buch; nicht darstellbare
  Elemente werden vereinfacht statt verschluckt und am Ende gemeldet.
- Erzeugt das EPUB **ohne externe Bibliothek** — läuft deshalb auch auf Mobile.

## Voraussetzungen

- **Obsidian 1.8.7** oder neuer.
- Desktop **und** Mobile — das Plugin ist nicht desktop-only.
- Für den Kapitel-Spine: eine Notiz, deren Embeds (`![[…]]`) die Kapitel in der
  gewünschten Reihenfolge nennen. Alles Weitere ist optional.

## Installation

**Community-Plugin-Liste (empfohlen):** *Einstellungen* → *Community-Plugins* →
*Durchsuchen* → nach **„EPUB Exporter"** suchen → installieren und aktivieren.

**Manuell:** `main.js`, `manifest.json` und `styles.css` aus dem
[Release](https://git.jkaindl.de/jkaindl/epub-exporter/releases) nach
`<vault>/.obsidian/plugins/epub-exporter/` kopieren.

**Aus dem Quelltext:** Repository klonen, `npm install && npm run build`,
dann dieselben drei Dateien in denselben Ordner kopieren.

## Verwendung

### Das Buch-Modell

Eine Buch-Notiz ist die einzige Quelle der Wahrheit. Ihr Frontmatter trägt die Metadaten, ihre
geordneten Embeds bilden den Kapitel-Spine:

```markdown
---
title: Der Sandmann
author: E. T. A. Hoffmann
language: de
cover: assets/cover.png
---

![[01 Nathanael an Lothar]]
![[02 Clara an Nathanael]]
![[03 Nathanael an Lothar]]
```

Weil die Kapitel echte Embeds sind, ist das fertige Buch in der Leseansicht direkt sichtbar —
es gibt keine separate Projektdatei, die mit der Notiz aus dem Tritt geraten könnte.

Erkannt werden `title`, `author`, `language`, `identifier`/`isbn`, `description`,
`publisher`, `date`, `series` + `series_index`, `subject`/`tags`, `rights` und `cover`
— jeweils **auch unter dem deutschen Namen** (`titel`, `autor`, `sprache`, `verlag`,
`datum`, `reihe` + `reihe_nr`, `schlagworte`, `rechte`, `titelbild`). Fehlt `title`,
dient der Dateiname als Titel; fehlt `identifier`, wird eine UUID erzeugt.
Der Befehl **„Buch-Frontmatter in Notiz einfügen"** legt das Gerüst an.

### Wege in den Export

- **Seitenleiste** — öffnet die Buchübersicht mit Kapitelliste, Export- und Konsolidieren-Schaltfläche.
- **Kapitel umsortieren** — in der Seitenleiste per Ziehen oder `Alt+↑/↓`; die neue Reihenfolge wandert
  sofort in den Embed-Spine der Buch-Notiz, sodass das Buch in der Leseansicht direkt neu sortiert erscheint.
- **Befehl** „Als EPUB exportieren" — exportiert die aktive Notiz.
- **Kontextmenü eines Ordners** — exportiert den Ordner als Buch **oder** importiert ihn als Buch-Notiz
  (Embed-Spine aus der Dateinamen-Reihenfolge).
- **Buch-Notiz → „In Ordner konsolidieren"** (Befehl, Seitenleiste oder Kontextmenü) — überführt das Buch
  in einen eigenständigen Ordner: Buch-Notiz + nummerierte Kapiteldateien + `_assets/`. Ein Dialog wählt,
  ob die Kapitel kopiert oder verschoben werden und wie viele Bilder mitkommen.

Pro Kapitel steuerbar: `chapter_title` überschreibt den Titel im Inhaltsverzeichnis,
`epub_exclude: true` lässt ein Kapitel aus.

## Konfiguration

*Einstellungen* → *Community-Plugins* → **EPUB Exporter**:

| Einstellung | Standard | Bedeutung |
|---|---|---|
| Ausgabeziel | Neben der Notiz | Oder: Anhang-Ordner, eigener Ordner, oder „Teilen / in anderer App öffnen" (Mobile) |
| Eigener Ordner | *(leer)* | Nur wirksam, wenn das Ausgabeziel „Eigener Ordner" ist |
| Standard-Buchsprache | `en` | Wird verwendet, wenn eine Buch-Notiz kein Sprachfeld hat |
| Seitenleiste beim Start öffnen | aus | Blendet das EPUB-Exporter-Panel beim Start von Obsidian ein |
| Konsolidieren: Kapiteldateien | Kopieren | Kopieren (Originale bleiben) oder Verschieben |
| Konsolidieren: Bilder | Vollständig | Cover + alle Kapitelbilder, nur Cover, oder keine |

Die beiden Konsolidieren-Einstellungen sind nur der **Vorschlag** im Dialog — dort lässt
sich je Vorgang abweichen.

## Funktionsweise

Das EPUB wird vollständig im Plugin gebaut, ohne EPUB- oder ZIP-Bibliothek: ein
minimaler, unkomprimierter ZIP-Writer schreibt `mimetype` zuerst (wie die Spezifikation
es verlangt), darauf Container, OPF-Paket und Navigations-Dokument. Deshalb läuft der
Export auch auf Mobile und braucht keine Netzwerkverbindung.

Jedes Kapitel wird von Obsidian gerendert und dann aus dem DOM nach XHTML übersetzt.
Was EPUB nicht kennt, wird auf das nächstliegende Element heruntergebrochen statt
weggelassen — wie viele Elemente das betraf, meldet eine Notiz nach dem Export.
Code-Blöcke werden vor dem Rendern gegen Platzhalter getauscht und danach unverändert
wieder eingesetzt, damit kein Syntax-Highlighting im Buch landet. Bilder sammelt eine
Registry ein und legt sie einmalig mit passendem Medientyp ab (PNG, JPEG, GIF, SVG,
WebP); Links auf Notizen innerhalb desselben Buchs werden zu internen Sprungzielen,
Links nach außen zu einfachem Text.

## Lizenz

AGPL-3.0-or-later — siehe [LICENSE](LICENSE).
