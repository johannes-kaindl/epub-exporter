import { describe, it, expect } from "vitest";
import { parseEmbedSpine, sortFolderChapters } from "../../src/core/spine-parser";

describe("parseEmbedSpine", () => {
  it("extracts top-level embeds in order", () => {
    const body = `# Book\n\n![[01 Intro]]\n![[02 Body]]\n![[03 End]]\n`;
    expect(parseEmbedSpine(body).map((e) => e.target)).toEqual([
      "01 Intro",
      "02 Body",
      "03 End",
    ]);
  });

  it("ignores an embed inside a paragraph (not top-level)", () => {
    const body = `See ![[aside]] here.\n\n![[real-chapter]]\n`;
    expect(parseEmbedSpine(body).map((e) => e.target)).toEqual(["real-chapter"]);
  });

  it("strips alias and heading from the target", () => {
    const body = `![[folder/Note#Section|Alias]]\n`;
    expect(parseEmbedSpine(body)[0].target).toBe("folder/Note");
  });

  it("returns empty for no embeds", () => {
    expect(parseEmbedSpine("just prose\n")).toEqual([]);
  });
});

describe("sortFolderChapters", () => {
  it("sorts numerically (2 before 10)", () => {
    expect(sortFolderChapters(["10 z.md", "2 a.md", "1 b.md"])).toEqual([
      "1 b.md",
      "2 a.md",
      "10 z.md",
    ]);
  });
});
