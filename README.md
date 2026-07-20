# EPUB Exporter

Exportiert Notizen als EPUB3 — eine einzelne Notiz oder ein ganzes Buch aus eingebetteten Kapiteln.

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
