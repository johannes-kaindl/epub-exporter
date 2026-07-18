import { describe, it, expect } from "vitest";
import {
  parseBookMetadata,
  isBookNote,
  BOOK_FRONTMATTER_TEMPLATE,
} from "../../src/core/frontmatter";

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
});

describe("BOOK_FRONTMATTER_TEMPLATE", () => {
  it("marks the note as a book", () => {
    expect(BOOK_FRONTMATTER_TEMPLATE.epub).toBe(true);
  });
});
