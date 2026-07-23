import { describe, it, expect } from "vitest";
import { buildImportPlan } from "../src/core/import-plan";

describe("buildImportPlan", () => {
  it("names the folder note after the folder", () => {
    const p = buildImportPlan("My Book", ["01 Intro", "02 Body"], "en");
    expect(p.bookNoteName).toBe("My Book.md");
  });

  it("scaffolds frontmatter with title = folder name and given language", () => {
    const p = buildImportPlan("My Book", ["a"], "de");
    expect(p.frontmatter.epub).toBe(true);
    expect(p.frontmatter.title).toBe("My Book");
    expect(p.frontmatter.language).toBe("de");
    expect(p.frontmatter.author).toBe("");
  });

  it("builds a numeric-aware sorted embed spine", () => {
    const p = buildImportPlan("B", ["10 Ten", "2 Two", "1 One"], "en");
    expect(p.body).toBe("![[1 One]]\n![[2 Two]]\n![[10 Ten]]");
  });

  it("excludes an existing folder note from the spine", () => {
    const p = buildImportPlan("My Book", ["My Book", "01 Intro"], "en");
    expect(p.body).toBe("![[01 Intro]]");
  });
});
