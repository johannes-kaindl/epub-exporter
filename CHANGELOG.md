# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning according to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Folder as book.** Right-click a folder and choose "Create EPUB": the sidebar shows the folder as a book (subfolders are chapters, their pages are sub-chapters, to any depth) and exports it with a nested table of contents in `nav.xhtml` and `toc.ncx`. Links between pages are resolved by the full path of the page, so `README.md` leads to the `README.md` next to it; an anchor (`#section`) is dropped and the link leads to the start of the page.
- **Order by name.** The new setting "Use numbers at the start of a name for order" (off by default) sorts by a number in front of a name (`01 - Intro`, `1.10` after `1.2`) and drops it from the title; a number that is 0 (`0 - Notes`, `000_Draft`) hides the item, `01` does not.
- **Intro pages and titles.** The setting "Intro pages" (for example `README, {{folder_name}}`) makes a page the entry of its chapter; "Page titles in a folder book" takes a page's title from its first heading (the default) or from its file name. `chapter_title` in a note always wins.
- **Working copy.** The setting "Working directory" and a switch in the sidebar let you work on a copy of the folder in the working directory instead of the original. The copy is built in a helper folder and renamed at the end, so an interrupted copy leaves nothing under the target name; an existing copy is never overwritten and never copied back. The EPUB is written next to the copy.

### Changed

- **The folder's context menu has one entry, "Create EPUB",** instead of "Export folder as book" and "Import folder as book note". The import is now the button "Create book note from folder" in the sidebar; it works as before.
- **A folder export now reads the whole folder tree.** It used to take only the files directly in the folder, in file name order, with the file name as the chapter title and a flat table of contents.
- **While the folder mode is open, renaming or moving the chosen folder (or one above it) keeps the sidebar on it** instead of falling back to the active note.

## [0.8.1] — 2026-10-26

### Changed

- **"Insert book frontmatter into note" now says so when there was nothing to add.** On a note that already has every book field, the message reads "Book frontmatter is already complete." instead of "Book frontmatter added."; the note is not touched either way. The same message appears when you press "Edit metadata" or "Make book" in the sidebar.

## [0.8.0] — 2026-10-25

### Changed

- **"Insert book frontmatter into note" no longer rewrites the whole front matter block.** It adds the missing book fields behind your own lines and leaves those as they are: a list written as `[a, b]` stays that way instead of turning into a block list, and comments in the block stay. A note with Windows line endings keeps them. Empty fields now appear as `title:` instead of `title: ""`; the plugin reads both the same. If the block is not closed, the note is left as it is and the plugin says so.

### Fixed

- **A book note with Windows line endings keeps one line ending when the cover path or the cover prompt is written, and when notes are consolidated into a folder.** The line after the closing `---` used to end with a plain line break in the middle of a note that otherwise ends its lines with Windows line endings, and a consolidated folder note mixed both. This is an edge case (such notes come from Windows sync); notes with plain line breaks are unchanged.

## [0.7.0] — 2026-10-24

### Fixed

- **A cover key written as a list or a multi-line block no longer leaves its old lines behind.** Setting the cover path or the cover prompt replaces the whole entry; before, the continuation lines stayed under the new value and damaged the note. If the key is a block scalar (`cover: |`) or the front matter block is not closed, the note is left as it is instead of being rewritten.
- **A `cover:` indented inside another structure is left alone.** The plugin used to rewrite it as if it were the book's cover key; it now appends its own key to the block.
- **A key written in another case (`Cover:`) is replaced, not duplicated.** The key found in the note is the one that is written; with both an English and a German key present the one the plugin reads is replaced.
- **In a note with Windows line endings, the added cover line ends with a Windows line ending too.** (The line after the closing `---` still ends with a plain line break; that is not changed here.)

### Added

- **The empty sidebar now says how to start a book.** With no note open, a second line under "Open a note to export it as EPUB." names the command to run: "Or turn a note into a book note: run the command “Insert book frontmatter into note”." (also in German). It is a sentence, not a button.

### Changed

- **The cover path and the cover prompt in the book's front matter are no longer always put in quotation marks.** They are quoted only where YAML needs it (a wikilink, a colon, a `#`, a leading dash, text that looks like a number or `true`): `cover_prompt: a marsh at dusk` instead of `cover_prompt: "a marsh at dusk"`. A prompt that reads as a number to a YAML parser (such as `1e5`) is no longer kept as text.
- **Line breaks in the cover prompt become blanks** before it is written into the front matter, so a multi-line prompt from the dialog stays one value.

- Internal only, nothing changes for readers: the Kit pins move from obsidian-kit 0.60.2 to 0.67.1 and from code-kit 0.27.1 to 0.36.0. Of the modules this plugin uses, only the "Share" export changed: it now rejects a file name made of `.` or `..` with blanks around it (`.. `), which the plugin never produces because every export name ends in `.epub`. The vendored CRC-32, file-name template, language, settings and vault-path modules are unchanged apart from their origin header. The Kit's front matter modules (`frontmatter`, `frontmatter-patch`) and `rel-path` are vendored but not used yet.

## [0.6.0] — 2026-10-14

### Added

- Settings, "Custom folder": the field now suggests the vault's folders while you type (it was a bare text field).
- Settings: the "Output destination" setting explains the options, including what "Share" leaves behind (a hidden `.epub-export` folder). A new "Cover generation" row says whether the "Generate cover" command and button are available, and if not, that they need the Local Image Generator plugin.

### Changed

- **"Share" no longer deletes files you put into `.epub-export`.** Before every export that hidden folder was emptied without asking. Now your own earlier exports (`.epub` files) are replaced silently, and any other file or folder in it is deleted only after you answer a question; if you say no, it stays and the export still runs. If sharing fails, you get a message instead of nothing.

- Internal only, nothing changes for readers: the Kit pins move to obsidian-kit 0.60.2 and code-kit 0.27.1; the vendored modules change only in their origin header. The CRC-32 of the EPUB zip writer and the file-name cleaning (`sanitizeBase`, fallback "Untitled") now come from the shared code-kit modules `crc32` and `filename-template` instead of local copies; both behave exactly as before. The `i18n` and `settings` modules move from obsidian-kit to code-kit with unchanged exports. The vendored settings helper gains `installTabRefreshOnOpen` (not used here).

## [0.5.1] — 2026-10-03

### Added

- The GitHub release now also carries a ready-to-unpack `epub-exporter.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

### Changed

- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.5.0] — 2026-09-26

### Added

- **Help row at the very top of the settings** with buttons for the documentation and the issue tracker (taken over from Kit 0.43.0).

## [0.4.0] — 2026-09-02

### Added

- **Cover images can now be generated when the "Local Image Generator" plugin
  is installed and active.** For a book note, the side panel shows a
  "Generate cover image" button (and a command of the same name); a dialog asks what the
  image should show and suggests something based on title and author. The result is **saved
  as a file next to the book note** and `cover:` points to it — so the cover is visible in
  reading mode, stays the same across exports and can be replaced by hand at any time.
  The description is stored in the note as `cover_prompt:`, so the next run starts from it.

  The dialog only offers what the image generator can actually do: the size selection comes from
  its reported capabilities and is omitted where there is only one size. If the plugin is missing or
  reports itself as not ready, the button does not appear at all.


## [0.3.2] — 2026-08-30

### Changed

- **The "Custom folder" setting now tolerates typed slash noise.** It is a
  free text field, and until now its value reached the vault with only leading and trailing
  slashes cleaned up. Backslashes now become `/`, and repeated inner slashes are
  collapsed — `Export\Bücher` and `Export//Bücher` both yield `Export/Bücher`, i.e. the
  form that Obsidian's vault adapter expects. From `obsidian-kit` 0.27.0 (`pure/vault-path.ts`).

## [0.3.1] — 2026-08-14

### Fixed

- The settings now look the same on all supported Obsidian versions.
  On versions before 1.13, the fallback view hid the "Custom folder" row
  unless the output target was already set to it — from 1.13 on it was always
  visible. Both views now read the same settings definition.

### Changed

- The README is now in English (`README.md`); the German version sits next to it as
  `README.de.md`.
- The README now documents the frontmatter fields of the book note for the first time, including their
  German aliases (`titel`, `autor`, `sprache`, `verlag`, …), as well as how
  the export works. The description of the settings was factually wrong — it named
  options for images and code blocks that do not exist — and now lists the
  settings that actually exist with their default values.

## [0.3.0] — 2026-07-24

### Added

- Chapters can be reordered in the sidebar by dragging or with `Alt+↑/↓`; the new
  order is written immediately into the embed spine of the book note.
- The chapter list now also updates when embeds are changed directly in the open
  book note.

## [0.2.0] — 2026-07-23

### Added

- **Consolidate into folder:** A book note is turned into a self-contained folder
  (book note + numbered chapter files + `_assets/`). A confirmation dialog
  chooses whether chapters are copied or moved and how many images are taken along
  (all · cover only · none); the defaults are set in the settings. Available via command,
  sidebar button and right-click on the book note.
- **Import folder as book:** A folder of Markdown files becomes a
  book note (folder note) with an embed spine sorted by file name — via right-click on
  the folder, without changing the existing files.

## [0.1.1] — 2026-07-23

### Changed

- Declarative settings API (`getSettingDefinitions()`): From Obsidian 1.13 on, the plugin settings
  appear in the settings search. The `display()` variant
  is kept as a fallback for Obsidian < 1.13.

## [0.1.0] — 2026-07-20

### Added

- Export of a note as EPUB3 — with the book note as single source of truth:
  frontmatter carries the metadata, ordered `![[embeds]]` form the chapter spine.
- Sidebar as hub view: book overview, chapter list, export with one click.
- Four output targets, cover image, internal links, images, code blocks.
- `chapter_title` override and `epub_exclude` per chapter.
- Book language German/English, follows the Obsidian UI language.
- Dependency-free engine: own store-only ZIP writer, own DOM→XHTML conversion.
