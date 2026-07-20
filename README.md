# EPUB Exporter

Exportiert Notizen als EPUB3 — eine einzelne Notiz oder ein ganzes Buch aus eingebetteten Kapiteln.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://codeberg.org/jkaindl/epub-exporter/src/branch/main/LICENSE)
[![Release](https://img.shields.io/badge/Release-0.1.0-green.svg)](https://codeberg.org/jkaindl/epub-exporter/releases)
[![Platform: Desktop + Mobile](https://img.shields.io/badge/Platform-Desktop%20%2B%20Mobile-blue.svg)](https://codeberg.org/jkaindl/epub-exporter/src/branch/main/manifest.json)

## Das Buch-Modell

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

## Benutzung

- **Seitenleiste** — öffnet die Buchübersicht mit Kapitelliste und Export-Schaltfläche.
- **Befehl** „Export as EPUB" — exportiert die aktive Notiz.
- **Kontextmenü eines Ordners** — exportiert den Ordner als Buch.

Pro Kapitel steuerbar: `chapter_title` überschreibt den Titel im Inhaltsverzeichnis,
`epub_exclude: true` lässt ein Kapitel aus.

## Einstellungen

Ausgabeziel (vier Varianten), Buchsprache (folgt standardmäßig der Oberflächensprache),
Behandlung von Bildern und Code-Blöcken.

## Installation

Über die Community-Plugin-Liste. Für die manuelle Installation `main.js`, `manifest.json` und
`styles.css` aus dem Release nach `<vault>/.obsidian/plugins/epub-exporter/` kopieren.

## Lizenz

AGPL-3.0-or-later — siehe [LICENSE](LICENSE).
