import { describe, it, expect } from "vitest";
import {
  parseBookMetadata,
  isBookNote,
  BOOK_FRONTMATTER_TEMPLATE,
} from "../../src/core/frontmatter";
import { stripFrontmatter } from "../../src/core/frontmatter";

const opts = { fallbackTitle: "Untitled", defaultLanguage: "en", rng: () => 0.5 };

describe("isBookNote", () => {
  it("is true for epub: true and false otherwise", () => {
    expect(isBookNote({ epub: true })).toBe(true);
    expect(isBookNote({ epub: "true" })).toBe(true);
    expect(isBookNote({ title: "x" })).toBe(false);
    expect(isBookNote(null)).toBe(false);
  });
});

describe("parseBookMetadata", () => {
  it("resolves German aliases", () => {
    const m = parseBookMetadata(
      { titel: "Mein Buch", autor: "Jay K", sprache: "de" },
      opts
    );
    expect(m.title).toBe("Mein Buch");
    expect(m.authors).toEqual(["Jay K"]);
    expect(m.language).toBe("de");
  });

  it("accepts an author list", () => {
    const m = parseBookMetadata({ author: ["A", "B"] }, opts);
    expect(m.authors).toEqual(["A", "B"]);
  });

  it("falls back to fallbackTitle and defaultLanguage", () => {
    const m = parseBookMetadata({}, opts);
    expect(m.title).toBe("Untitled");
    expect(m.language).toBe("en");
  });

  it("generates a urn:uuid identifier when absent", () => {
    const m = parseBookMetadata({}, opts);
    expect(m.identifier).toMatch(/^urn:uuid:/);
  });

  it("keeps a provided identifier", () => {
    const m = parseBookMetadata({ identifier: "isbn:123" }, opts);
    expect(m.identifier).toBe("isbn:123");
  });

  it("collects subjects/tags as an array", () => {
    const m = parseBookMetadata({ tags: ["a", "b"] }, opts);
    expect(m.subjects).toEqual(["a", "b"]);
  });

  it("coerces a bare-number title/identifier to a string", () => {
    const m = parseBookMetadata({ title: 2024, identifier: 12345 }, opts);
    expect(m.title).toBe("2024");
    expect(typeof m.title).toBe("string");
    expect(m.identifier).toBe("12345");
  });

  it("does not treat an unrelated `id` field as the identifier", () => {
    const m = parseBookMetadata({ id: "note-42" }, opts);
    expect(m.identifier).not.toBe("note-42");
    expect(m.identifier).toMatch(/^urn:uuid:/);
  });

  // Regression test for the scalarToString() fix: a nested frontmatter object
  // (e.g. `description: { note: "..." }` from malformed YAML) must be dropped,
  // not stringified via Object.prototype.toString() into the literal
  // "[object Object]" that would otherwise land in the exported EPUB metadata.
  // `description` has no string fallback in parseBookMetadata, so this asserts
  // the raw asString() outcome directly.
  it("drops a nested object value instead of writing '[object Object]'", () => {
    const m = parseBookMetadata({ description: { note: "nested" } }, opts);
    expect(m.description).toBeUndefined();
    expect(m.description).not.toBe("[object Object]");
  });

  it("still coerces string/number/boolean scalars to a string", () => {
    const m = parseBookMetadata({ title: "Plain String", rights: true }, opts);
    expect(m.title).toBe("Plain String");
    expect(m.rights).toBe("true");

    const numeric = parseBookMetadata({ title: 2024 }, opts);
    expect(numeric.title).toBe("2024");
  });

  // Obsidian's YAML parser turns an unquoted `date: 2024-01-15` into a real
  // Date instance. Date overrides toString(), so it must still come through
  // as a string (this is the one type besides string/number/boolean that
  // scalarToString() deliberately keeps).
  it("stringifies a Date value for a date field (unquoted YAML date)", () => {
    const d = new Date("2024-01-15T00:00:00.000Z");
    const m = parseBookMetadata({ date: d }, opts);
    expect(m.date).toBe(String(d));
    expect(typeof m.date).toBe("string");
  });

  it("drops non-scalar entries (null/undefined/object) from a mixed author array", () => {
    const m = parseBookMetadata(
      { author: ["A", null, { name: "nested" }, "B", undefined] },
      opts
    );
    expect(m.authors).toEqual(["A", "B"]);
  });

  it("keeps a pure string array unchanged", () => {
    const m = parseBookMetadata({ subject: ["fiction", "adventure"] }, opts);
    expect(m.subjects).toEqual(["fiction", "adventure"]);
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML block, keeps body", () => {
    const md = ["---", "epub: true", "title: X", "---", "", "# Body", "text"].join("\n");
    expect(stripFrontmatter(md)).toBe(["", "# Body", "text"].join("\n"));
  });
  it("returns content unchanged when there is no frontmatter", () => {
    expect(stripFrontmatter("# Body only")).toBe("# Body only");
  });
});

describe("BOOK_FRONTMATTER_TEMPLATE", () => {
  it("marks the note as a book", () => {
    expect(BOOK_FRONTMATTER_TEMPLATE.epub).toBe(true);
  });
});
