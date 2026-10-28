// vendored from code-kit@0.43.0, src/ts/pure/heading-title.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The text of the first Markdown heading of a note, as plain text: the title a note gets when its file name is not wanted
 *  (`# 🎓 Lektion 1 — Überleben` → "🎓 Lektion 1 — Überleben"). Works on the raw text, so a preview and an export read the same
 *  title without rendering anything. String logic only, no I/O; linear in the length of the text.
 *
 *  Origin: the "folder as book" design of epub-exporter (`_SDD/2026-10-27-epub-exporter-ordner-als-buch-design.md` § 5.4), where the
 *  table of contents would otherwise list file names such as `plugin-hinzufuegen-aendern-entfernen`.
 *
 *  What counts as the first heading: an ATX heading (`#` to `######`, a space or tab after the hashes, at most three spaces of
 *  indent) outside a fenced code block (``` or ~~~), anywhere in the text — text before it is fine. Setext headings (a line
 *  underlined with `===`) are not read. If that first heading has no text left once its markup is gone (`# `, `# <br>`), the answer
 *  is `null` and later headings are not tried: the heading is the title, and an empty title falls back to the caller's own.
 *
 *  What becomes plain text: wikilinks (`[[a/b|Alias]]` → "Alias", `[[a/b]]` → "b", an embed `![[x.png]]` → "x.png"), links and
 *  images (`[text](url)` → "text"), `**bold**`, `__bold__`, `*em*`, `_em_` (not inside a word: `snake_case` stays), `~~strike~~`,
 *  `==mark==`, `` `code` `` (its content kept as it is), simple HTML tags, a backslash before punctuation, closing `#`s
 *  (`# Title ##`; `# C#` keeps its `#`). Runs of whitespace become one space. Emoji and other text stay.
 *
 *  `body` is the text after the frontmatter; the caller strips that. `\r\n` and a lone `\r` end a line like `\n`. */

const ATX = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_HASHES = /(?:^|[ \t]+)#+[ \t]*$/;

/** The plain text of the first heading of `body`, or `null` if there is no heading or it has no text. */
export function firstHeadingText(body: string): string | null {
  let fence: string | null = null;
  for (const line of body.split(/\r\n|\r|\n/)) {
    const open = FENCE.exec(line);
    if (fence !== null) {
      // A closing fence: the same character, at least as long, nothing but blanks after it.
      if (open && (open[1] ?? "").startsWith(fence.charAt(0)) && (open[1] ?? "").length >= fence.length && (open[2] ?? "").trim() === "") {
        fence = null;
      }
      continue;
    }
    // A backtick fence cannot have a backtick in its info string (that line is inline code).
    if (open && !((open[1] ?? "").startsWith("`") && (open[2] ?? "").includes("`"))) {
      fence = open[1] ?? "";
      continue;
    }
    const heading = ATX.exec(line);
    if (heading) {
      const text = toPlainText((heading[1] ?? "").replace(CLOSING_HASHES, ""));
      return text === "" ? null : text;
    }
  }
  return null;
}

/** Placeholders keep code spans and escaped characters out of the markup passes. U+E000/U+E001 (private use, not control characters, which eslint `no-control-regex` rejects in a pattern) never occur in a note title, and
 *  any that do are dropped first so that a placeholder cannot be forged. */
const stashOpen = "\uE000";
const stashClose = "\uE001";

function toPlainText(raw: string): string {
  const stash: string[] = [];
  const keep = (s: string): string => {
    stash.push(s);
    return `${stashOpen}${stash.length - 1}${stashClose}`;
  };
  let s = raw.replace(/[\uE000\uE001]/g, "");
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => keep(code));
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~=|<>])/g, (_m, c: string) => keep(c));
  s = s.replace(/(!?)\[\[([^\]]*)\]\]/g, (_m, bang: string, inner: string) => {
    const bar = inner.indexOf("|");
    // An embed's `|…` is a size (`![[a.png|100]]`), a link's is the text shown.
    if (bar >= 0 && bang === "") return inner.slice(bar + 1);
    const target = bar >= 0 ? inner.slice(0, bar) : inner;
    return target.slice(target.lastIndexOf("/") + 1);
  });
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  s = s.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?>/g, "");
  s = s.replace(/\*\*(?=\S)([^*]*\S)\*\*/g, "$1");
  s = s.replace(/(?<!\w)__(?=\S)([^_]*\S)__(?!\w)/g, "$1");
  s = s.replace(/\*(?=\S)([^*]*\S)\*/g, "$1");
  s = s.replace(/(?<!\w)_(?=\S)([^_]*\S)_(?!\w)/g, "$1");
  s = s.replace(/~~(?=\S)([^~]*\S)~~/g, "$1");
  s = s.replace(/==(?=\S)([^=]*\S)==/g, "$1");
  s = s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => stash[Number(i)] ?? "");
  return s.replace(/\s+/g, " ").trim();
}
