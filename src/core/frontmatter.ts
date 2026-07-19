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
};

function pick(fm: Record<string, unknown>, canonical: string): unknown {
  for (const key of ALIASES[canonical] ?? [canonical]) {
    const v = fm[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  return [String(v)].filter((s) => s.length > 0);
}

function asString(v: unknown): string | undefined {
  return v === undefined ? undefined : String(v);
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
  };
}

// Strip a leading YAML frontmatter block so the body handed to a renderer/parser
// has no raw YAML. Shared by deps.ts (render) and sidebar-bridge.ts (spine read).
export function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (m) return content.slice(m[0].length);
  }
  return content;
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
