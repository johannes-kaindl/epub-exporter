import { defineStrings } from "../vendor/kit/i18n";

export const EN: Record<string, string> = {
  "cmd.exportBook": "Export book as EPUB",
  "cmd.exportNote": "Export note as EPUB",
  "cmd.exportFolder": "Export folder as EPUB",
  "cmd.insertFrontmatter": "Insert book frontmatter into note",
  "cmd.exportRibbon": "Export as EPUB",
  "notice.noActiveNote": "Open a Markdown note first.",
  "notice.noChapters": "Nothing to export — this book has no chapters.",
  "notice.saved": "EPUB saved to {0}.",
  "notice.shared": "EPUB ready to share.",
  "notice.simplified": "EPUB created. {0} element(s) were simplified (e.g. callouts, math).",
  "notice.brokenEmbed": "{0} embedded chapter(s) could not be found and were skipped.",
  "notice.fmAdded": "Book frontmatter added.",
  "notice.fmFailed": "Could not add book frontmatter.",
  "notice.exportFailed": "EPUB export failed — see console for details.",
};

export const DE: Record<string, string> = {
  "cmd.exportBook": "Buch als EPUB exportieren",
  "cmd.exportNote": "Notiz als EPUB exportieren",
  "cmd.exportFolder": "Ordner als EPUB exportieren",
  "cmd.insertFrontmatter": "Buch-Frontmatter in Notiz einfügen",
  "cmd.exportRibbon": "Als EPUB exportieren",
  "notice.noActiveNote": "Öffne zuerst eine Markdown-Notiz.",
  "notice.noChapters": "Nichts zu exportieren — dieses Buch hat keine Kapitel.",
  "notice.saved": "EPUB gespeichert unter {0}.",
  "notice.shared": "EPUB bereit zum Teilen.",
  "notice.simplified": "EPUB erstellt. {0} Element(e) wurden vereinfacht (z.B. Callouts, Mathe).",
  "notice.brokenEmbed": "{0} eingebettete(s) Kapitel nicht gefunden und übersprungen.",
  "notice.fmAdded": "Buch-Frontmatter ergänzt.",
  "notice.fmFailed": "Buch-Frontmatter konnte nicht ergänzt werden.",
  "notice.exportFailed": "EPUB-Export fehlgeschlagen — Details in der Konsole.",
};

export function registerI18n(): void {
  defineStrings({ en: EN, de: DE });
}
