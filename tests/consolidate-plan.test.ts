// tests/consolidate-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildConsolidatePlan, ConsolidateInput } from "../src/core/consolidate-plan";

function baseInput(over: Partial<ConsolidateInput> = {}): ConsolidateInput {
  return {
    bookTitle: "Der Titel des Buchs",
    chapters: [
      { sourcePath: "notes/Vorwort.md", title: "Vorwort", imageRefs: [] },
      { sourcePath: "notes/Einleitung.md", title: "Einleitung", imageRefs: [] },
    ],
    leadingProse: "",
    coverPath: null,
    assetMode: "none",
    existingFolderNames: [],
    ...over,
  };
}

describe("buildConsolidatePlan core", () => {
  it("names folder and book note from the sanitized title", () => {
    const p = buildConsolidatePlan(baseInput());
    expect(p.folderName).toBe("Der Titel des Buchs");
    expect(p.bookNoteName).toBe("Der Titel des Buchs.md");
  });

  it("numbers chapters in spine order with a padded prefix", () => {
    const p = buildConsolidatePlan(baseInput());
    expect(p.chapters.map((c) => c.targetName)).toEqual([
      "01 - Vorwort.md",
      "02 - Einleitung.md",
    ]);
    expect(p.chapters[0].sourcePath).toBe("notes/Vorwort.md");
  });

  it("builds an embed spine body, prefixing leading prose when present", () => {
    const p = buildConsolidatePlan(baseInput({ leadingProse: "Eine Widmung." }));
    expect(p.bookNoteBody).toBe(
      "Eine Widmung.\n\n![[01 - Vorwort]]\n![[02 - Einleitung]]"
    );
  });

  it("omits broken embeds and counts them as skipped", () => {
    const p = buildConsolidatePlan(
      baseInput({
        chapters: [
          { sourcePath: "notes/A.md", title: "A", imageRefs: [] },
          { sourcePath: null, title: "Broken", imageRefs: [] },
          { sourcePath: "notes/B.md", title: "B", imageRefs: [] },
        ],
      })
    );
    expect(p.chapters.map((c) => c.targetName)).toEqual(["01 - A.md", "02 - B.md"]);
    expect(p.skipped).toBe(1);
  });

  it("suffixes the folder name on collision with a sibling", () => {
    const p = buildConsolidatePlan(
      baseInput({ existingFolderNames: ["Der Titel des Buchs", "Der Titel des Buchs (2)"] })
    );
    expect(p.folderName).toBe("Der Titel des Buchs (3)");
    expect(p.bookNoteName).toBe("Der Titel des Buchs (3).md");
  });

  it("sanitizes illegal filename characters in the title", () => {
    const p = buildConsolidatePlan(baseInput({ bookTitle: "A/B: C?" }));
    expect(p.folderName).toBe("AB C");
  });

  it("pads chapter numbers to the width of the largest index", () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      sourcePath: `n/${i}.md`, title: `T${i}`, imageRefs: [],
    }));
    const p = buildConsolidatePlan(baseInput({ chapters }));
    expect(p.chapters[0].targetName).toBe("01 - T0.md");
    expect(p.chapters[11].targetName).toBe("12 - T11.md");
  });
});
