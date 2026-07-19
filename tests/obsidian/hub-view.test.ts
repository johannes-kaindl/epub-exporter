import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, TFile, WorkspaceLeaf } from "../mocks/obsidian";
import { resolveTargetFile } from "../../src/obsidian/hub-view";

function appWithLeaf(leafView: unknown): App {
  return {
    workspace: {
      rootSplit: {},
      getMostRecentLeaf: () => (leafView === null ? null : { view: leafView }),
    },
  } as unknown as App;
}

describe("resolveTargetFile", () => {
  it("returns the file of the most-recent markdown leaf", () => {
    const v = new MarkdownView();
    const f = new TFile();
    f.path = "Book.md";
    v.file = f;
    expect(resolveTargetFile(appWithLeaf(v))?.path).toBe("Book.md");
  });

  it("returns null when the most-recent leaf is not a markdown view", () => {
    expect(resolveTargetFile(appWithLeaf(new WorkspaceLeaf()))).toBeNull();
  });

  it("returns null when there is no leaf", () => {
    expect(resolveTargetFile(appWithLeaf(null))).toBeNull();
  });

  it("returns null when the markdown view has no file", () => {
    expect(resolveTargetFile(appWithLeaf(new MarkdownView()))).toBeNull();
  });
});
