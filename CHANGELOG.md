# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning according to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The GitHub release now also carries a ready-to-unpack `epub-exporter.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

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
