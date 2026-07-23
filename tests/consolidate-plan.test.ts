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

describe("buildConsolidatePlan assets", () => {
  it("none mode carries no assets and no cover rewrite", () => {
    const p = buildConsolidatePlan(
      baseInput({ assetMode: "none", coverPath: "img/cover.png" })
    );
    expect(p.assets).toEqual([]);
    expect(p.coverRewrite).toBeNull();
  });

  it("cover mode copies only the cover and rewrites the cover value", () => {
    const p = buildConsolidatePlan(
      baseInput({ assetMode: "cover", coverPath: "img/cover.png" })
    );
    expect(p.assets).toEqual([{ sourcePath: "img/cover.png", targetName: "_assets/cover.png" }]);
    expect(p.coverRewrite).toBe("[[_assets/cover.png]]");
    expect(p.chapters.every((c) => c.rewrites.length === 0)).toBe(true);
  });

  it("full mode copies cover + chapter images and rewrites chapter refs", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: "img/cover.png",
        chapters: [
          {
            sourcePath: "notes/A.md",
            title: "A",
            imageRefs: [{ raw: "pic.png", resolvedPath: "media/pic.png" }],
          },
        ],
      })
    );
    expect(p.assets).toContainEqual({ sourcePath: "img/cover.png", targetName: "_assets/cover.png" });
    expect(p.assets).toContainEqual({ sourcePath: "media/pic.png", targetName: "_assets/pic.png" });
    expect(p.chapters[0].rewrites).toEqual([{ from: "pic.png", to: "_assets/pic.png" }]);
  });

  it("full mode dedupes the same source path across chapters", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [
          { sourcePath: "a.md", title: "A", imageRefs: [{ raw: "x.png", resolvedPath: "m/x.png" }] },
          { sourcePath: "b.md", title: "B", imageRefs: [{ raw: "x.png", resolvedPath: "m/x.png" }] },
        ],
      })
    );
    expect(p.assets.filter((a) => a.sourcePath === "m/x.png")).toHaveLength(1);
  });

  it("full mode suffixes colliding basenames from different sources", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [
          { sourcePath: "a.md", title: "A", imageRefs: [{ raw: "one/pic.png", resolvedPath: "one/pic.png" }] },
          { sourcePath: "b.md", title: "B", imageRefs: [{ raw: "two/pic.png", resolvedPath: "two/pic.png" }] },
        ],
      })
    );
    expect(p.assets.map((a) => a.targetName).sort()).toEqual([
      "_assets/pic (2).png",
      "_assets/pic.png",
    ]);
    expect(p.chapters[1].rewrites[0].to).toBe("_assets/pic (2).png");
  });

  it("full mode skips unresolved refs", () => {
    const p = buildConsolidatePlan(
      baseInput({
        assetMode: "full",
        coverPath: null,
        chapters: [{ sourcePath: "a.md", title: "A", imageRefs: [{ raw: "gone.png", resolvedPath: null }] }],
      })
    );
    expect(p.assets).toEqual([]);
    expect(p.chapters[0].rewrites).toEqual([]);
  });
});
