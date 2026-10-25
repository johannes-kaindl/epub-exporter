import { describe, it, expect } from "vitest";
import {
  parseBookMetadata,
  isBookNote,
  BOOK_FRONTMATTER_TEMPLATE,
  splitFrontmatter,
  setCoverPath,
  setCoverPrompt,
} from "../../src/core/frontmatter";
import { stripFrontmatter } from "../../src/core/frontmatter";
import { parseFrontmatter } from "../../src/vendor/kit/frontmatter";

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

describe("splitFrontmatter", () => {
  it("splits a note into frontmatter head and body", () => {
    const content = "---\ntitle: X\n---\n# Heading\nText";
    const { head, body } = splitFrontmatter(content);
    expect(head).toBe("---\ntitle: X\n---\n");
    expect(body).toBe("# Heading\nText");
  });

  it("returns an empty head when there is no frontmatter", () => {
    const { head, body } = splitFrontmatter("# Just a heading");
    expect(head).toBe("");
    expect(body).toBe("# Just a heading");
  });

  it("always recomposes to the original content", () => {
    for (const c of ["---\na: 1\n---\nbody", "no frontmatter", "---\nunterminated\nbody"]) {
      const { head, body } = splitFrontmatter(c);
      expect(head + body).toBe(c);
    }
  });
});

describe("cover prompt", () => {
  it("reads cover_prompt and its German alias", () => {
    expect(parseBookMetadata({ cover_prompt: "a lighthouse" }, opts).coverPrompt)
      .toBe("a lighthouse");
    expect(parseBookMetadata({ titelbild_prompt: "ein Leuchtturm" }, opts).coverPrompt)
      .toBe("ein Leuchtturm");
  });

  it("leaves coverPrompt undefined when the key is absent", () => {
    expect(parseBookMetadata({ title: "x" }, opts).coverPrompt).toBeUndefined();
  });
});

describe("setCoverPath", () => {
  it("replaces an existing cover value", () => {
    const fm = '---\ntitle: X\ncover: "[[old.png]]"\n---';
    expect(setCoverPath(fm, "new.png")).toContain('cover: "[[new.png]]"');
    expect(setCoverPath(fm, "new.png")).not.toContain("old.png");
  });

  it("replaces the German alias in place, without adding a second key", () => {
    // Writing an English `cover:` next to an existing `titelbild:` would leave
    // the note with two cover keys, and `pick()` would answer with the first.
    const out = setCoverPath('---\ntitelbild: "[[alt.png]]"\n---', "neu.png");
    expect(out).toContain('titelbild: "[[neu.png]]"');
    expect(out).not.toContain("cover:");
  });

  it("adds a cover key when the note has none", () => {
    const out = setCoverPath("---\ntitle: X\n---", "new.png");
    expect(out).toContain('cover: "[[new.png]]"');
    expect(out.trimEnd().endsWith("---")).toBe(true);
  });

  it("keeps CRLF line endings when it appends", () => {
    const out = setCoverPath("---\r\ntitle: X\r\n---", "new.png");
    expect(out).toBe('---\r\ntitle: X\r\ncover: "[[new.png]]"\r\n---');
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("finds an alias whatever its case and writes the key as the note has it", () => {
    const out = setCoverPath('---\nCover: "[[old.png]]"\n---', "new.png");
    expect(out).toBe('---\nCover: "[[new.png]]"\n---');
    expect(out.match(/cover:/gi)).toHaveLength(1);
  });

  it("with both aliases present replaces the one pick() reads, in ALIASES order", () => {
    const out = setCoverPath('---\ntitelbild: "[[a.png]]"\ncover: "[[b.png]]"\n---', "new.png");
    expect(out).toBe('---\ntitelbild: "[[a.png]]"\ncover: "[[new.png]]"\n---');
  });

  it("does not touch an indented `cover:` inside a sub-structure, it appends its own key", () => {
    const fm = "---\nmeta:\n  cover: keep\n---";
    expect(setCoverPath(fm, "new.png")).toBe('---\nmeta:\n  cover: keep\ncover: "[[new.png]]"\n---');
  });

  it("replaces a list value with its continuation lines", () => {
    const out = setCoverPath("---\ncover:\n  - a.png\n  - b.png\ntitle: X\n---", "new.png");
    expect(out).toBe('---\ncover: "[[new.png]]"\ntitle: X\n---');
  });

  it("returns the block unchanged when the cover key is a block scalar", () => {
    const fm = "---\ncover: |\n  [[x.png]]\n---";
    expect(setCoverPath(fm, "new.png")).toBe(fm);
  });

  it("returns an unclosed block unchanged", () => {
    expect(setCoverPath("---\ncover: x\n", "new.png")).toBe("---\ncover: x\n");
  });

  it("leaves a note without a block alone", () => {
    expect(setCoverPath("", "new.png")).toBe("");
  });
});

describe("setCoverPrompt", () => {
  it("stores the prompt so the next run starts from it", () => {
    const out = setCoverPrompt("---\nepub: true\n---", "a marsh at dusk");
    expect(out).toBe("---\nepub: true\ncover_prompt: a marsh at dusk\n---");
  });

  it("replaces an existing prompt and its German alias in place", () => {
    expect(setCoverPrompt('---\ncover_prompt: "old"\n---', "new")).toContain("cover_prompt: new");
    const de = setCoverPrompt('---\ntitelbild_prompt: "alt"\n---', "neu");
    expect(de).toContain("titelbild_prompt: neu");
    expect(de).not.toContain("cover_prompt:");
  });

  it("keeps a prompt with quotes readable by the front matter reader", () => {
    // Prompts are free text from a text area. An unescaped quote would leave
    // the note with frontmatter Obsidian can no longer parse — which would
    // silently stop it being a book note at all.
    const out = setCoverPrompt("---\nepub: true\n---\n", 'a "quoted" phrase');
    expect(parseFrontmatter(out).data.cover_prompt).toBe('a "quoted" phrase');
  });

  it.each([
    "a marsh, at dusk",
    "time: 5 pm",
    "#hashtag first",
    "fog \u{1F32B}\u{FE0F} over the reeds",
    "- starts with a dash",
    "[[not a link]]",
    "true",
  ])("round-trips the prompt %j through the front matter reader", (prompt) => {
    // The ports hand over the head only (`splitFrontmatter`), the body is put back by the caller.
    const out = setCoverPrompt("---\nepub: true\n---\n", prompt) + "Body\n";
    const fm = parseFrontmatter(out);
    expect(fm.data.cover_prompt).toBe(prompt);
    expect(fm.data.epub).toBe("true");
    expect(fm.body).toBe("Body\n");
  });

  it("folds line breaks in the prompt into blanks", () => {
    const out = setCoverPrompt("---\nepub: true\n---", "a marsh\nat dusk\r\n\r\nand rain");
    expect(out).toBe("---\nepub: true\ncover_prompt: a marsh at dusk and rain\n---");
  });

  it("keeps CRLF line endings when it appends", () => {
    const out = setCoverPrompt("---\r\nepub: true\r\n---", "a marsh");
    expect(out).toBe("---\r\nepub: true\r\ncover_prompt: a marsh\r\n---");
  });

  it("does not add a second prompt key next to an alias in another case", () => {
    const out = setCoverPrompt("---\nCover_Prompt: old\n---", "new");
    expect(out).toBe("---\nCover_Prompt: new\n---");
  });

  it("returns the block unchanged when the prompt key is a block scalar", () => {
    const fm = "---\ncover_prompt: |\n  old\n  text\n---";
    expect(setCoverPrompt(fm, "new")).toBe(fm);
  });

  it("leaves the block alone for an empty prompt", () => {
    const fm = "---\nepub: true\n---";
    expect(setCoverPrompt(fm, "   ")).toBe(fm);
    expect(setCoverPrompt(fm, "\n \r\n")).toBe(fm);
  });
});

// The template's empty fields were written as `title: ""` up to 0.7.0 (processFrontMatter) and are written as `title:` (YAML null,
// the kit's writer) since the switch to patchFrontmatter. `pick()` drops undefined, null and "" alike, so the metadata must not differ.
describe("empty template fields: null and \"\" read the same", () => {
  const emptied = (empty: unknown): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(BOOK_FRONTMATTER_TEMPLATE).map(([k, v]) => [k, v === "" ? empty : v])
    );

  it("gives the same metadata for a note with `key:` (null) as for `key: \"\"`", () => {
    const withEmptyStrings = parseBookMetadata(emptied(""), { ...opts, fallbackTitle: "Basename" });
    const withNulls = parseBookMetadata(emptied(null), { ...opts, fallbackTitle: "Basename" });
    expect(withNulls).toEqual(withEmptyStrings);
  });

  it("falls back for an empty title, whichever way it is written", () => {
    for (const empty of ["", null]) {
      const m = parseBookMetadata({ ...emptied(empty), title: empty }, { ...opts, fallbackTitle: "Basename" });
      expect(m.title).toBe("Basename");
      expect(m.authors).toEqual([]);
      expect(m.language).toBe("en");
    }
  });

  it("the comparison can fail: a non-empty title is not the fallback", () => {
    const m = parseBookMetadata({ ...emptied(null), title: "Real" }, { ...opts, fallbackTitle: "Basename" });
    expect(m.title).toBe("Real");
  });
});
