# Getting started

This walks you from the install to your first EPUB: a book note with three chapters, exported from the sidebar. It takes about five minutes and needs nothing but Obsidian.

## 1. Install

*Settings* → *Community plugins* → *Browse* → search for **EPUB Exporter** → *Install* → *Enable*. For a manual install see the [README](https://github.com/johannes-kaindl/epub-exporter/blob/main/README.md#install).

## 2. Write three chapters

Create three notes, for example `01 Arrival`, `02 The Road` and `03 Home`, each with a few lines of text. Every note becomes one chapter; its file name is the chapter title in the table of contents (the `chapter_title` field overrides it).

## 3. Make a book note

Create a fourth note, `My First Book`, and open it. Run the command **Insert book frontmatter into note** (command palette). The plugin adds the frontmatter scaffold, including the line `epub: true` — that line is what makes the note a *book note*. Set `title: My First Book`, and fill in `author` and `language`.

Below the frontmatter, list the chapters as embeds, one per line, in the order they should appear:

```markdown
![[01 Arrival]]
![[02 The Road]]
![[03 Home]]
```

Switch to reading view: the three chapters run on as one continuous text. That is the book.

## 4. Export

Click the ribbon icon **Open EPUB Exporter sidebar** (the book icon). The panel shows the note as a **Book note** with its chapter list. Press **Export as EPUB**.

A notice says **EPUB saved to …** and the file `My First Book.epub` — named after the `title` field — lies next to the note. Open it in any e-reader app to check the result.

## Where next

- Reorder chapters by dragging in the panel or with `Alt+↑/↓`; the embed lines in the note move with them.
- Add a cover with the `cover` field, and metadata such as `series` or `publisher` — the README lists all recognised fields, each also under its German name.
- Change where the file lands under *Settings* → *EPUB Exporter* → **Output destination**.
- Something went differently? See [Troubleshooting](troubleshooting.md).
