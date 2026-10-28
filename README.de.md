# EPUB Exporter

Exportiert Notizen als EPUB3 — eine einzelne Notiz oder ein ganzes Buch aus eingebetteten Kapiteln.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE)
[![Doku: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/epub-exporter?label=release)](https://github.com/johannes-kaindl/epub-exporter/releases)
[![Platform: Desktop + Mobile](https://img.shields.io/badge/Platform-Desktop%20%2B%20Mobile-blue.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/manifest.json)

> [🇬🇧 English](https://github.com/johannes-kaindl/epub-exporter/blob/main/README.md) · 🇩🇪 Deutsch
>
> **Hinweis:** Diese Übersetzung folgt der englischen README. Bei Abweichungen gilt die englische Fassung.

<p align="center"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/hero.png" width="820" alt="Eine Buch-Notiz in der Leseansicht: die eingebetteten Kapitel laufen als fortlaufender Text durch, rechts listet das EPUB-Exporter-Panel sie auf"></p>

## Features

- **Ein Buch ist eine Notiz.** Frontmatter trägt die Metadaten, die eingebetteten
  Kapitel bilden den Spine — keine separate Projektdatei, die aus dem Tritt gerät.
- Einzelne Notiz, Buch-Notiz oder ganzer **Ordner** als EPUB3 exportieren.
- **Ordner als Buch.** Rechtsklick auf einen Ordner, *EPUB erstellen*, und seine Unterordner werden Kapitel mit verschachteltem Inhaltsverzeichnis; eine Zahl vor dem Namen legt die Reihenfolge fest, eine `0` blendet aus, und eine Arbeitskopie erlaubt Umbenennen und Umsortieren, ohne das Original anzufassen.
- **Seitenleiste** mit Kapitelliste; Umsortieren per Ziehen oder `Alt+↑/↓` schreibt
  die neue Reihenfolge direkt in den Embed-Spine der Buch-Notiz zurück.
- **Ordner als Buch importieren** und Buch-Notizen **in einen Ordner konsolidieren**
  (nummerierte Kapiteldateien + `_assets/`).
- Metadaten-Felder auf Deutsch oder Englisch (`autor`/`author`, `titelbild`/`cover`, …).
- Bilder, interne Links und Code-Blöcke wandern mit ins Buch; nicht darstellbare
  Elemente werden vereinfacht statt verschluckt und am Ende gemeldet.
- **Titelbild erzeugen** aus der Buch-Notiz, wenn das Plugin [Local Image Generator](https://github.com/johannes-kaindl/local-image-generator) installiert ist.
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
[Release](https://github.com/johannes-kaindl/epub-exporter/releases) nach
`<vault>/.obsidian/plugins/epub-exporter/` kopieren.

**Aus dem Quelltext:** Repository klonen, `npm install && npm run build`,
dann dieselben drei Dateien in denselben Ordner kopieren.

## Verwendung

### Das Buch-Modell

Eine Buch-Notiz ist die einzige Quelle der Wahrheit. Ihr Frontmatter trägt die Metadaten, ihre
geordneten Embeds bilden den Kapitel-Spine:

```markdown
---
epub: true
title: Der Sandmann
author: E. T. A. Hoffmann
language: de
cover: assets/cover.png
---

![[01 Nathanael an Lothar]]
![[02 Clara an Nathanael]]
![[03 Nathanael an Lothar]]
```

Die Zeile `epub: true` (oder `book: true`) macht die Notiz zur Buch-Notiz; ohne sie wird die Notiz als einzelne Notiz exportiert und ihre Embeds werden nicht aufgelöst. Weil die Kapitel echte Embeds sind, ist das fertige Buch in der Leseansicht direkt sichtbar —
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
- **Kontextmenü eines Ordners** — ein Eintrag, **EPUB erstellen**, öffnet die Seitenleiste im Ordnermodus (siehe [Ordner als Buch](#ordner-als-buch)).
- **Buch-Notiz → „In Ordner konsolidieren"** (Befehl, Seitenleiste oder Kontextmenü) — überführt das Buch
  in einen eigenständigen Ordner: Buch-Notiz + nummerierte Kapiteldateien + `_assets/`. Ein Dialog wählt,
  ob die Kapitel kopiert oder verschoben werden und wie viele Bilder mitkommen.

<img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/consolidate-modal.png" width="820" alt="Der Dialog „In Ordner konsolidieren“: Zusammenfassungszeile, die Wahl zwischen Kopieren und Verschieben der Kapiteldateien und wie viele Bilder mitkommen">

Pro Kapitel steuerbar: `chapter_title` überschreibt den Titel im Inhaltsverzeichnis,
`epub_exclude: true` lässt ein Kapitel aus.

### Ordner als Buch

Rechtsklick auf einen Ordner im Datei-Explorer, dann **EPUB erstellen**. Die Seitenleiste wechselt in den Ordnermodus: Sie zeigt das Buch so, wie es exportiert wird (Unterordner sind Kapitel, ihre Seiten Unterkapitel, beliebig tief), einen Hinweis zur Zahlenregel, den Schalter für die Arbeitskopie und die Schaltfläche **Als EPUB exportieren**. Die Vorschau folgt dem Umbenennen, Anlegen und Löschen im Ordner. Der Ordnermodus endet, wenn du ihn schließt (das × in der Kopfzeile) oder einen anderen Ordner mit der rechten Maustaste wählst; ein Wechsel der aktiven Notiz beendet ihn nicht, und ein Umbenennen oder Verschieben des Ordners im Datei-Explorer wird mitgemacht.

- **Reihenfolge und Namen.** Ohne weitere Einstellung sortieren Seiten und Unterordner nach dem Namen, Zahlen werden als Zahlen verglichen (`2` vor `10`). Ist *Zahlen am Namensanfang für die Reihenfolge nutzen* an, sortiert eine vorangestellte Zahl den Eintrag (`01 - Einleitung`, `2. Weiter`; `1.10 Foo` kommt nach `1.2 Foo`) und fällt aus dem Titel weg. Eine Zahl, die `0` ist (`0 - Notizen`, `000_Entwurf`), blendet den Eintrag aus, einen Ordner samt allem darin; `01` blendet nicht aus. Ziffern, die unmittelbar in einen Buchstaben übergehen, gehören zum Namen (`3D Grafik`). Das Panel nennt, wie viele Einträge ausgeblendet sind.
- **Einleitungsseiten.** *Einleitungsseiten* nennt Seitennamen, zum Beispiel `README, {{folder_name}}` (`{{folder_name}}` steht für den Namen des Ordners). Eine Seite mit so einem Namen eröffnet ihr Kapitel und ist dessen Eintrag im Inhaltsverzeichnis; die Einleitungsseite des gewählten Ordners steht als Erstes im Buch. Ein Kapitel ohne Einleitungsseite führt auf seine erste Seite.
- **Titel.** `chapter_title` in einer Notiz gilt immer. Sonst entscheidet *Seitentitel im Ordner-Buch*: die erste Überschrift (ohne Überschrift der Dateiname) oder der Dateiname.
- **Links zwischen Seiten** werden über den vollen Pfad der Seite aufgelöst: `[weiter](README.md)` führt zur `README.md` im selben Ordner, auch wenn viele Seiten so heißen. Ein Anker (`#abschnitt`) entfällt, der Link führt an den Anfang der Seite. Ein Link auf eine Seite außerhalb des Buchs (ausgeblendet, ausgeschlossen, in einem anderen Ordner) wird zu Text ohne Link.
- **Inhaltsverzeichnis.** Verschachtelt in `nav.xhtml` und in `toc.ncx`, sodass ein Reader zu jedem Kapitel springen kann.
- **Arbeitskopie.** Lege in den Einstellungen ein *Arbeitsverzeichnis* fest (ein Ordner im Vault). Der Schalter *Arbeitskopie* im Panel bietet dann *Arbeitskopie anlegen*: Der ganze Ordnerbaum, mit Bildern und Anhängen, wird nach `<Arbeitsverzeichnis>/<Vault-Pfad des Ordners>` kopiert. Vorschau und Export lesen die Kopie, und das EPUB landet neben der Kopie. Eine vorhandene Kopie wird nie überschrieben, weil du dort umbenannt hast, und nichts geht ins Original zurück. Die Kopie entsteht in einem Hilfsordner neben dem Ziel und wird am Ende umbenannt; ein Abbruch hinterlässt so nie eine halbe Kopie unter dem Zielnamen, und ein liegen gebliebener Hilfsordner geht beim nächsten Versuch in den Papierkorb.
- **Buch-Notiz aus Ordner anlegen.** Das Panel behält auch den früheren Import: Er schreibt eine Buch-Notiz mit einem Embed je Datei des Ordners (flach, in Dateinamen-Reihenfolge). Er war früher ein Eintrag im Kontextmenü des Ordners.

## Konfiguration

*Einstellungen* → *Community-Plugins* → **EPUB Exporter**:

| Einstellung | Standard | Bedeutung |
|---|---|---|
| Ausgabeziel | Neben der Notiz | Oder: Anhang-Ordner, eigener Ordner, oder „Teilen / in anderer App öffnen" (Mobile). „Teilen" schreibt die Datei in einen versteckten Ordner `.epub-export` im Vault und ersetzt dort deine früheren Exporte; alles andere in diesem Ordner wird nur nach Rückfrage gelöscht |
| Eigener Ordner | *(leer)* | Nur wirksam, wenn das Ausgabeziel „Eigener Ordner" ist; schlägt Vault-Ordner beim Tippen vor |
| Standard-Buchsprache | `en` | Wird verwendet, wenn eine Buch-Notiz kein Sprachfeld hat |
| Seitenleiste beim Start öffnen | aus | Blendet das EPUB-Exporter-Panel beim Start von Obsidian ein |
| Konsolidieren: Kapiteldateien | Kopieren | Kopieren (Originale bleiben) oder Verschieben |
| Konsolidieren: Bilder | Vollständig | Cover + alle Kapitelbilder, nur Cover, oder keine |
| Zahlen am Namensanfang für die Reihenfolge nutzen | aus | Ordner als Buch: Eine Zahl vor dem Namen legt die Reihenfolge fest und fällt aus dem Titel weg; eine Zahl, die 0 ist, blendet den Eintrag aus |
| Arbeitsverzeichnis | *(leer)* | Ordner als Buch: Vault-Ordner, in dem die Arbeitskopien liegen; leer heißt keine Arbeitskopie |
| Einleitungsseiten | *(leer)* | Ordner als Buch: Namen der Seite, die ein Kapitel eröffnet, durch Kommas getrennt, mit `{{folder_name}}` für den Namen des Ordners |
| Seitentitel im Ordner-Buch | Erste Überschrift | Oder der Dateiname; `chapter_title` in einer Notiz gilt immer |

Die beiden Konsolidieren-Einstellungen sind nur der **Vorschlag** im Dialog — dort lässt
sich je Vorgang abweichen.

<a href="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/settings.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/thumbs/settings.png" width="380" alt="Der Einstellungen-Tab von EPUB Exporter mit den ersten sechs Einstellungen"></a><br><sub>Vorschau anklicken für den vollständigen Einstellungen-Tab</sub>

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

## Dokumentation

- [Dokumentations-Index](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/README.md) (Englisch)
- [Getting started](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/getting-started.md) — von der Installation zum ersten EPUB
- [Troubleshooting](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/troubleshooting.md) — die Meldungen, die auftreten können, was sie bedeuten und was zu tun ist

## Lizenz

AGPL-3.0-or-later — siehe [LICENSE](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE). Die Dokumentation steht unter CC BY-SA 4.0, siehe [LICENSE-DOCS](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE-DOCS).
