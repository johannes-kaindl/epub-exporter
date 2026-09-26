# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text (in a German interface the same messages appear in German) — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## The EPUB contains only the book note, not the chapters

No message appears; the export succeeds, but the book has one chapter — the book note itself, with the embeds left as text. In the sidebar the note is listed as **Note**, not **Book note**.

**Cause:** the note is not marked as a book note. Only notes with `epub: true` (or `book: true`) in the frontmatter are read as a book; every other note is exported as a single note.

**Fix:** press **Make into a book** in the sidebar, run the command **Insert book frontmatter into note**, or add `epub: true` to the frontmatter by hand. The sidebar then shows **Book note** and the chapter list.

## This note is not a book note

> This note is not a book note (add book frontmatter first).

**Cause:** you used **Consolidate to folder** or **Generate cover**, or reordered chapters, on a note without `epub: true` (or `book: true`) in its frontmatter — or the note lost that line while the action was running.

**Fix:** press **Make into a book** in the sidebar (or run **Insert book frontmatter into note**), then repeat the action.

## Open a Markdown note first

> Open a Markdown note first.

**Cause:** no Markdown note is active — for example a canvas, an image or an empty tab has the focus.

**Fix:** click into the note you want to export, then run **Export as EPUB** again. The sidebar shows "Open a note to export it as EPUB." in the same situation.

## Nothing to export

> Nothing to export — this book has no chapters.

**Cause:** the book note contains no embed lines, or a folder export found no notes.

**Fix:** list the chapters as embeds in the book note, one per line (`![[01 Arrival]]`). Only whole-line embeds count as chapters, so an embed in the middle of a sentence is ignored.

## Chapters could not be found

> 2 embedded chapter(s) could not be found and were skipped.

**Cause:** an embed points to a note that does not exist or is spelled differently — a renamed chapter is the usual reason. The EPUB is still written, without those chapters. The sidebar counts them as "{n} chapter(s) missing".

**Fix:** correct the embed names in the book note, then export again.

## Some elements were simplified

> EPUB created. 3 element(s) were simplified (e.g. callouts, math).

**Cause:** this is a report, not an error. EPUB cannot represent everything Obsidian can render, so unknown elements are turned into the nearest simple element instead of being dropped.

**Fix:** nothing is required. Open the EPUB and check the marked passages; rewrite them as plain paragraphs if they matter.

## EPUB export failed

> EPUB export failed — see console for details.

**Cause:** something unexpected happened while building or writing the file.

**Fix:** open the developer console (`Ctrl+Shift+I`, on macOS `Cmd+Option+I`), run the export again and read the error there. Include it when you [ask for help](#getting-help).

## The chapter order was not applied

> The book note changed in the meantime — chapter order was not applied.

**Cause:** the book note was edited — by you or by sync — between the moment the panel read it and the moment you dropped the chapter.

**Fix:** drag the chapter again. If it keeps happening, see the next entry.

> Could not save the new chapter order — see console for details.

**Cause:** writing the new order into the book note failed, for example because the file is read-only.

**Fix:** check the file's permissions and the console, then try again.

## Importing a folder as a book

> That folder has no notes to import.

**Cause:** the folder holds no Markdown notes.

**Fix:** put the chapter notes directly into the folder; the file name order becomes the chapter order.

> A book note already exists in that folder.

**Cause:** **Import folder as book** would create a second book note next to an existing one.

**Fix:** open the existing book note, or move it out of the folder first.

## Generating a cover

The command **Generate cover for this book** and the panel button **Generate cover** only appear when the [Local Image Generator](https://github.com/johannes-kaindl/local-image-generator) plugin is installed and enabled. The messages below name what the generator reported.

> Install and enable the Local Image Generator plugin to generate covers.

**Fix:** install and enable the plugin, then reopen the book note.

> The image generator has no server configured.

**Fix:** enter the server address in the settings of Local Image Generator.

> The image server is not responding.

**Fix:** start the image server and check the address, then try again.

> The image generator has no model downloaded.

**Fix:** download a model in the settings of Local Image Generator.

> The image generator found no usable GPU.

**Fix:** the generator needs a GPU it can use; check its own documentation for the supported setups.

> The image generator is busy — try again in a moment.

**Cause:** another image is still being generated. **Fix:** wait for it to finish and press **Generate** again.

> Cover generation failed — see console for details.

**Fix:** read the console for the underlying error and include it when you [ask for help](#getting-help).

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/epub-exporter/issues) with your Obsidian version, the plugin version (*Settings* → *Community plugins*) and what you expected to happen. If a notice mentions the console, add what it says there.
