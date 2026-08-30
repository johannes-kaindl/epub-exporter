import { describe, it, expect } from "vitest";
import { buildCoverPrompt } from "../../src/core/cover-prompt";

const base = { title: "Notes from the Salt Marsh", authors: [] as string[] };

describe("buildCoverPrompt", () => {
  it("uses a stored prompt verbatim", () => {
    // The book note is the source of truth: a prompt the user wrote must not be
    // rewritten, decorated or "improved" on the way to the generator.
    expect(
      buildCoverPrompt({ ...base, coverPrompt: "a lighthouse at dusk, oil painting" })
    ).toBe("a lighthouse at dusk, oil painting");
  });

  it("builds a prompt from title and author when none is stored", () => {
    const p = buildCoverPrompt({ title: "Grey Weather", authors: ["Jay K"] });
    expect(p).toContain("Grey Weather");
    expect(p).toContain("Jay K");
    expect(p.toLowerCase()).toContain("book cover");
  });

  it("omits the author clause when the book has no author", () => {
    const p = buildCoverPrompt(base);
    expect(p).toContain("Notes from the Salt Marsh");
    expect(p.toLowerCase()).not.toContain("by ");
  });

  it("joins multiple authors", () => {
    const p = buildCoverPrompt({ title: "X", authors: ["A", "B"] });
    expect(p).toContain("A, B");
  });

  it("treats a blank stored prompt as absent", () => {
    // An empty `cover_prompt:` key is what Obsidian leaves behind when a user
    // clears the field. Sending "" to the generator would fail the request for
    // a reason the user cannot see.
    const p = buildCoverPrompt({ ...base, coverPrompt: "   " });
    expect(p).toContain("Notes from the Salt Marsh");
  });
});
