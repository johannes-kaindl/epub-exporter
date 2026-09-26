# EPUB Exporter

Export notes as EPUB3 — a single note, or a whole book assembled from embedded chapters.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/epub-exporter?label=release)](https://github.com/johannes-kaindl/epub-exporter/releases)
[![Platform: Desktop + Mobile](https://img.shields.io/badge/Platform-Desktop%20%2B%20Mobile-blue.svg)](https://github.com/johannes-kaindl/epub-exporter/blob/main/manifest.json)

> 🇬🇧 English · [🇩🇪 Deutsch](https://github.com/johannes-kaindl/epub-exporter/blob/main/README.de.md)

<p align="center"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/hero.png" width="820" alt="A book note in reading view: the embedded chapters run on as continuous prose, with the EPUB Exporter panel listing them on the right"></p>

## Features

- **A book is a note.** Frontmatter carries the metadata, the embedded chapters form
  the spine — no separate project file that drifts out of sync.
- Export a single note, a book note, or an entire **folder** as EPUB3.
- **Sidebar** with the chapter list; reordering by drag or `Alt+↑/↓` writes the new
  order straight back into the book note's embed spine.
- **Import a folder as a book** and **consolidate a book note into a folder**
  (numbered chapter files + `_assets/`).
- Metadata fields in German or English (`autor`/`author`, `titelbild`/`cover`, …).
- Images, internal links and code blocks travel into the book; anything EPUB cannot
  represent is simplified rather than swallowed, and reported afterwards.
- **Generate a cover** from the book note when the [Local Image Generator](https://github.com/johannes-kaindl/local-image-generator) plugin is installed.
- Builds the EPUB **without an external library** — which is why it also runs on
  mobile.

## Requirements

- **Obsidian 1.8.7** or newer.
- Desktop **and** mobile — the plugin is not desktop-only.
- For the chapter spine: a note whose embeds (`![[…]]`) name the chapters in the
  intended order. Everything else is optional.

## Install

**Community plugin list (recommended):** *Settings* → *Community plugins* → *Browse* →
search for **"EPUB Exporter"** → install and enable.

**Manual install:** copy `main.js`, `manifest.json` and `styles.css` from a
[release](https://github.com/johannes-kaindl/epub-exporter/releases) into
`<vault>/.obsidian/plugins/epub-exporter/`.

**From source:** clone the repository, run `npm install && npm run build`, then copy the
same three files into the same folder.

## Usage

### The book model

A book note is the single source of truth. Its frontmatter carries the metadata, its
ordered embeds form the chapter spine:

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

The line `epub: true` (or `book: true`) marks the note as a book note; without it the note is exported as a single note and its embeds are not followed. Because the chapters are real embeds, the finished book is visible as such in reading
view — there is no separate project file that could drift out of sync with the note.

Recognized fields are `title`, `author`, `language`, `identifier`/`isbn`, `description`,
`publisher`, `date`, `series` + `series_index`, `subject`/`tags`, `rights` and `cover` —
each **also under its German name** (`titel`, `autor`, `sprache`, `verlag`, `datum`,
`reihe` + `reihe_nr`, `schlagworte`, `rechte`, `titelbild`). Without `title` the file
name is used; without `identifier` a UUID is generated. The command **"Insert book
frontmatter into note"** lays out the scaffold.

### Ways into an export

- **Sidebar** — opens the book overview with the chapter list plus export and
  consolidate buttons.
- **Reorder chapters** — in the sidebar by dragging or with `Alt+↑/↓`; the new order
  goes straight into the book note's embed spine, so the book reorders itself in
  reading view immediately.
- **Command** "Export as EPUB" — exports the active note.
- **A folder's context menu** — exports the folder as a book **or** imports it as a book
  note (embed spine from the file name order).
- **Book note → "Consolidate book to folder"** (command, sidebar or context menu) —
  moves the book into a folder of its own: book note + numbered chapter files +
  `_assets/`. A dialog picks whether chapters are copied or moved, and how many images
  come along.

<a href="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/sidebar-book.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/thumbs/sidebar-book.png" width="380" alt="The EPUB Exporter panel for a book note: chapter list with drag handles, the hint “Drag to reorder · Alt+arrow keys”, and the buttons Export as EPUB, Edit metadata and Consolidate to folder"></a><br><sub>The panel — click the preview for full size</sub>

<a href="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/reorder.gif"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/reorder.gif" width="380" alt="A chapter is moved with Alt+arrow-down; the matching embed line moves with it in the book note"></a>
<sub>Reordering, by dragging or with <code>Alt+↑/↓</code> — the embed line in the note moves with it.</sub>

<img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/consolidate-modal.png" width="820" alt="The Consolidate to folder dialog: a summary line, the choice between copying and moving chapter files, and how many images come along">

Per chapter: `chapter_title` overrides the title in the table of contents,
`epub_exclude: true` leaves a chapter out.

## Configuration

*Settings* → *Community plugins* → **EPUB Exporter**:

| Setting | Default | Meaning |
|---|---|---|
| Output destination | Beside the note | Or: attachment folder, custom folder, or "Share / open in another app" (mobile) |
| Custom folder | *(empty)* | Only used when the output destination is "Custom folder" |
| Default book language | `en` | Used when a book note has no language field |
| Open sidebar on startup | off | Reveals the EPUB Exporter panel when Obsidian starts |
| Consolidate: chapter files | Copy | Copy (keep originals) or move |
| Consolidate: images | Full | Cover + all chapter images, cover only, or none |

The two consolidate settings are only the **default** in the dialog — it lets you
deviate per run.

<a href="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/settings.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/thumbs/settings.png" width="380" alt="The EPUB Exporter settings tab with all six settings"></a><br><sub>Click the preview for the full-size settings tab</sub>

## How it works

The EPUB is built entirely inside the plugin, without an EPUB or ZIP library: a minimal,
uncompressed ZIP writer puts `mimetype` first (as the specification demands), followed by
the container, the OPF package and the navigation document. That is why the export also
works on mobile and needs no network connection.

Each chapter is rendered by Obsidian and then translated from the DOM into XHTML.
Whatever EPUB does not know is degraded to the closest element rather than dropped — a
notice reports how many elements that affected. Code blocks are swapped for placeholders
before rendering and put back unchanged afterwards, so no syntax highlighting ends up in
the book. Images are collected by a registry and stored once with the right media type
(PNG, JPEG, GIF, SVG, WebP); links to notes within the same book become internal jump
targets, links pointing outside become plain text.

## Documentation

- [Documentation index](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/README.md)
- [Getting started](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/getting-started.md) — from the install to your first EPUB
- [Troubleshooting](https://github.com/johannes-kaindl/epub-exporter/blob/main/docs/troubleshooting.md) — the messages you may see, what they mean and what to do

## License

AGPL-3.0-or-later — see [LICENSE](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE). The documentation is licensed CC BY-SA 4.0, see [LICENSE-DOCS](https://github.com/johannes-kaindl/epub-exporter/blob/main/LICENSE-DOCS).
