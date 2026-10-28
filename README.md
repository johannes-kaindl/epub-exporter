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
- **Folder as book.** Right-click a folder, choose *Create EPUB*, and its subfolders become chapters with a nested table of contents; a number in front of a name sets the order, a `0` hides, and a working copy lets you rename and reorder without touching the original.
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
- **A folder's context menu** — one entry, **Create EPUB**, opens the sidebar in folder mode (see [Folder as book](#folder-as-book)).
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

### Folder as book

Right-click a folder in the file explorer and choose **Create EPUB**. The sidebar switches to the folder mode: it shows the book as it will be exported (subfolders are chapters, their pages are sub-chapters, to any depth), a hint on the number rule, the working copy switch and the **Export as EPUB** button. The preview follows renaming, adding and deleting in the folder. The folder mode ends when you close it (the × in the panel header) or right-click another folder; switching the active note does not end it, and renaming or moving the folder in the file explorer is followed.

- **Order and names.** By default pages and subfolders sort by name, numbers compared as numbers (`2` before `10`). With *Use numbers at the start of a name for order* on, a number in front sorts the item (`01 - Intro`, `2. Next`; `1.10 Foo` comes after `1.2 Foo`) and is dropped from the title. A number that is `0` (`0 - Notes`, `000_Draft`) hides the item, a folder with everything in it; `01` does not hide. Digits that run straight into a letter belong to the name (`3D Grafik`). The panel says how many items are hidden.
- **Intro pages.** *Intro pages* lists page names, for example `README, {{folder_name}}` (`{{folder_name}}` is the name of the folder). A page with such a name opens its chapter and is the chapter's entry in the table of contents; the intro page of the chosen folder comes first in the book. A chapter without an intro page links to its first page.
- **Titles.** `chapter_title` in a note always wins. Otherwise *Page titles in a folder book* decides: the first heading (the file name if there is none), or the file name.
- **Links between pages** are resolved by the full path of the page, so `[next](README.md)` leads to the `README.md` next to it even when many pages carry that name. An anchor (`#section`) is dropped: the link leads to the start of the page. A link to a page outside the book (hidden, excluded, in another folder) becomes plain text.
- **Table of contents.** Nested in both `nav.xhtml` and `toc.ncx`, so a reader can jump to any chapter.
- **Working copy.** Set a *Working directory* (a vault folder) in the settings. The panel's *Working copy* switch then offers *Create working copy*: the whole folder tree, images and attachments included, is copied to `<working directory>/<vault path of the folder>`. Preview and export read the copy, and the EPUB is written next to the copy. An existing copy is never overwritten, because you renamed things there, and nothing is copied back to the original. The copy is built in a helper folder next to the target and renamed at the end, so an interrupted copy never leaves a half copy under the target name; a leftover helper folder goes to the trash on the next try.
- **Create book note from folder.** The panel also keeps the earlier import: it writes a book note with one embed per file of the folder (flat, in file name order). It used to be an entry in the folder's context menu.

## Configuration

*Settings* → *Community plugins* → **EPUB Exporter**:

| Setting | Default | Meaning |
|---|---|---|
| Output destination | Beside the note | Or: attachment folder, custom folder, or "Share / open in another app" (mobile). "Share" writes the file to a hidden `.epub-export` folder in the vault, replacing your earlier exports there; anything else in that folder is deleted only after you confirm |
| Custom folder | *(empty)* | Only used when the output destination is "Custom folder"; suggests vault folders as you type |
| Default book language | `en` | Used when a book note has no language field |
| Open sidebar on startup | off | Reveals the EPUB Exporter panel when Obsidian starts |
| Consolidate: chapter files | Copy | Copy (keep originals) or move |
| Consolidate: images | Full | Cover + all chapter images, cover only, or none |
| Use numbers at the start of a name for order | off | Folder as book: a number in front of a name sets the order and is dropped from the title; a number that is 0 hides the item |
| Working directory | *(empty)* | Folder as book: vault folder that holds the working copies; empty means no working copy |
| Intro pages | *(empty)* | Folder as book: names of the page that opens a chapter, separated by commas, with `{{folder_name}}` for the folder's name |
| Page titles in a folder book | First heading | Or the file name; `chapter_title` in a note always wins |

The two consolidate settings are only the **default** in the dialog — it lets you
deviate per run.

<a href="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/settings.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/epub-exporter/main/docs/images/thumbs/settings.png" width="380" alt="The EPUB Exporter settings tab with its first six settings"></a><br><sub>Click the preview for the full-size settings tab</sub>

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
