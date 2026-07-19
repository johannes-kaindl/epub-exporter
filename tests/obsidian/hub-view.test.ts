import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, TFile, WorkspaceLeaf } from "../mocks/obsidian";
import { resolveTargetFile, EpubHubView } from "../../src/obsidian/hub-view";
import type { SidebarSnapshot } from "../../src/core/sidebar-model";

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

describe("EpubHubView re-render dedup (two-click guard)", () => {
  // Each renderSidebar call starts with root.empty() → a fresh children array,
  // so array-identity tells us whether a rebuild happened.
  function viewWith(snaps: SidebarSnapshot[]) {
    let i = 0;
    const bridge = {
      snapshot: async () => snaps[Math.min(i++, snaps.length - 1)],
      handlers: { onExport: () => {}, onInsertFrontmatter: () => {} },
    };
    return new EpubHubView(new WorkspaceLeaf() as never, bridge);
  }

  it("does NOT rebuild the DOM when the resolved model is unchanged", async () => {
    // Focusing the sidebar fires active-leaf-change, but the target note (rootSplit)
    // is unchanged, so the model is identical. A rebuild here would destroy the
    // button under the pointer and eat the first click.
    const snap: SidebarSnapshot = { kind: "note", title: "A", chapters: [] };
    const view = viewWith([snap, snap]);
    await (view as unknown as { rerender: () => Promise<void> }).rerender();
    const firstChildren = (view.contentEl as unknown as { children: unknown[] }).children;
    await (view as unknown as { rerender: () => Promise<void> }).rerender();
    expect((view.contentEl as unknown as { children: unknown[] }).children).toBe(firstChildren);
  });

  it("DOES rebuild the DOM when the model changes (context switch)", async () => {
    const view = viewWith([
      { kind: "note", title: "A", chapters: [] },
      { kind: "note", title: "B", chapters: [] },
    ]);
    await (view as unknown as { rerender: () => Promise<void> }).rerender();
    const firstChildren = (view.contentEl as unknown as { children: unknown[] }).children;
    await (view as unknown as { rerender: () => Promise<void> }).rerender();
    expect((view.contentEl as unknown as { children: unknown[] }).children).not.toBe(firstChildren);
  });
});
