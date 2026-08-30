import { BookMetadata } from "./model";
import { generateUrnUuid } from "./uuid";

// Canonical field -> accepted frontmatter keys (English + German aliases).
const ALIASES: Record<string, string[]> = {
  title: ["title", "titel"],
  author: ["author", "autor", "authors", "autoren"],
  language: ["language", "sprache", "lang"],
  identifier: ["identifier", "isbn"],
  description: ["description", "beschreibung"],
  publisher: ["publisher", "verlag"],
  date: ["date", "datum"],
  series: ["series", "serie", "reihe"],
  seriesIndex: ["series_index", "seriesIndex", "reihe_nr"],
  subject: ["subject", "subjects", "tags", "schlagworte"],
  rights: ["rights", "rechte", "lizenz"],
  cover: ["cover", "titelbild"],
  // What the cover should DEPICT, as opposed to `cover`, which says where the
  // finished image LIVES. Kept in the note rather than in plugin settings: it
  // describes this one book, and the book note is where a book's own facts go.
  coverPrompt: ["cover_prompt", "coverPrompt", "titelbild_prompt"],
};

function pick(fm: Record<string, unknown>, canonical: string): unknown {
  for (const key of ALIASES[canonical] ?? [canonical]) {
    const v = fm[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// Coerce a scalar frontmatter value to a string. Deliberately narrow: only
// types with a meaningful (non-default) toString() are converted. Plain
// objects/arrays are rejected (-> undefined) instead of falling through to
// Object.prototype.toString(), which would silently write the literal
// "[object Object]" into the book's metadata for malformed frontmatter
// (e.g. a nested `author: { name: ... }` block instead of a plain string).
function scalarToString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Some YAML parsers (incl. Obsidian's) turn an unquoted `date: 2024-01-15`
  // into a real Date instance. Date overrides toString() (unlike a plain
  // object), so String(v) here is safe and matches the prior behaviour.
  if (v instanceof Date) return String(v);
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => scalarToString(x))
      .filter((s): s is string => s !== undefined && s.length > 0);
  }
  const s = scalarToString(v);
  return s !== undefined && s.length > 0 ? [s] : [];
}

function asString(v: unknown): string | undefined {
  return scalarToString(v);
}

export interface ParseOptions {
  fallbackTitle: string; // note basename, used when no title field is set
  defaultLanguage: string; // used when no language field is set
  rng?: () => number; // injectable for deterministic tests
}

export function isBookNote(fm: Record<string, unknown> | null | undefined): boolean {
  if (!fm) return false;
  const v = fm["epub"] ?? fm["book"];
  return v === true || v === "true";
}

export function parseBookMetadata(
  fm: Record<string, unknown>,
  opts: ParseOptions
): BookMetadata {
  const identifier = asString(pick(fm, "identifier")) || generateUrnUuid(opts.rng);
  return {
    title: asString(pick(fm, "title")) || opts.fallbackTitle,
    authors: asStringArray(pick(fm, "author")),
    language: asString(pick(fm, "language")) || opts.defaultLanguage,
    identifier,
    description: asString(pick(fm, "description")),
    publisher: asString(pick(fm, "publisher")),
    date: asString(pick(fm, "date")),
    series: asString(pick(fm, "series")),
    seriesIndex: asString(pick(fm, "seriesIndex")),
    subjects: asStringArray(pick(fm, "subject")),
    rights: asString(pick(fm, "rights")),
    coverImagePath: asString(pick(fm, "cover")),
    coverPrompt: asString(pick(fm, "coverPrompt")),
  };
}

// Split a note into its leading YAML frontmatter block and the remaining body.
// head + body always recomposes to the input, so a writer can put the note back
// together after rewriting only the body.
export function splitFrontmatter(content: string): { head: string; body: string } {
  if (content.startsWith("---")) {
    const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (m) return { head: m[0], body: content.slice(m[0].length) };
  }
  return { head: "", body: content };
}

// Strip a leading YAML frontmatter block so the body handed to a renderer/parser
// has no raw YAML. Shared by deps.ts (render) and sidebar-bridge.ts (spine read).
export function stripFrontmatter(content: string): string {
  return splitFrontmatter(content).body;
}

// Fields scaffolded by the "Insert book frontmatter" command (Plan 2).
// Canonical English keys; the user may rename to German aliases.
export const BOOK_FRONTMATTER_TEMPLATE: Record<string, unknown> = {
  epub: true,
  title: "",
  author: "",
  language: "en",
  cover: "",
  description: "",
  date: "",
  publisher: "",
  identifier: "",
  series: "",
  series_index: "",
  subject: [],
  rights: "",
};

/**
 * Points a book note's cover key at a vault path, as a quoted wikilink.
 *
 * Operates on the raw frontmatter text rather than a parsed object on purpose:
 * rewriting the whole block would reorder keys, drop comments and normalise
 * quoting in a note the user hand-writes. Only the one line changes.
 *
 * The German alias is replaced IN PLACE rather than joined by an English key —
 * two cover keys in one note would leave `pick()` to decide which wins, and it
 * answers with whichever the alias list names first, not the newer one.
 *
 * Moved here from `obsidian/consolidate.ts` (2026-08-30), where it was private:
 * it is pure string work on frontmatter, and a second caller now needs it.
 */
export function setCoverPath(frontmatter: string, coverPath: string | null): string {
  if (!coverPath) return frontmatter;
  return setQuotedKey(frontmatter, /^(\s*(?:cover|titelbild)\s*:).*$/mi, "cover", `[[${coverPath}]]`);
}

/**
 * Stores what the cover should depict, so the next run starts from it.
 *
 * The value is free text from a text area, so quotes are escaped: an unescaped
 * one would end the YAML string early and leave a note Obsidian can no longer
 * parse — which would silently stop it being a book note at all.
 */
export function setCoverPrompt(frontmatter: string, prompt: string): string {
  const value = prompt.trim();
  if (!value) return frontmatter;
  return setQuotedKey(
    frontmatter,
    /^(\s*(?:cover_prompt|coverPrompt|titelbild_prompt)\s*:).*$/mi,
    "cover_prompt",
    value
  );
}

/** Replaces a key's value in place, or appends the key before the closing fence. */
function setQuotedKey(frontmatter: string, line: RegExp, canonicalKey: string, value: string): string {
  const quoted = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (line.test(frontmatter)) return frontmatter.replace(line, `$1 ${quoted}`);
  return frontmatter.replace(/\n---\s*$/, `\n${canonicalKey}: ${quoted}\n---`);
}
