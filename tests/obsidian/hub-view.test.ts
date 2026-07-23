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

describe("EpubHubView · Neuaufbau waehrend einer Geste", () => {
  function viewWith(snaps: SidebarSnapshot[]) {
    let i = 0;
    const bridge = {
      snapshot: async () => snaps[Math.min(i++, snaps.length - 1)],
      handlers: {
        onExport: () => {},
        onInsertFrontmatter: () => {},
        onConsolidate: () => {},
        onReorder: () => {},
      },
    };
    return new EpubHubView(new WorkspaceLeaf() as never, bridge);
  }
  const priv = (v: EpubHubView) =>
    v as unknown as { rerender: () => Promise<void>; setDragging: (a: boolean) => void };

  it("defers a rebuild while a drag is in flight and runs it once afterwards", async () => {
    const view = viewWith([
      { kind: "book", title: "B", chapters: [{ title: "A", status: "ok" }] },
      { kind: "book", title: "B", chapters: [{ title: "Z", status: "ok" }] },
    ]);
    await priv(view).rerender();
    const before = (view.contentEl as unknown as { children: unknown[] }).children;

    priv(view).setDragging(true);
    await priv(view).rerender(); // must not touch the DOM under the pointer
    expect((view.contentEl as unknown as { children: unknown[] }).children).toBe(before);

    priv(view).setDragging(false);
    await Promise.resolve(); // the deferred rerender is scheduled, not awaited
    await Promise.resolve();
    expect((view.contentEl as unknown as { children: unknown[] }).children).not.toBe(before);
  });
});

describe("EpubHubView · Sperre nach dem Snapshot-Await", () => {
  const priv = (v: EpubHubView) =>
    v as unknown as { rerender: () => Promise<void>; setDragging: (a: boolean) => void };

  it("re-checks the drag lock after the snapshot await, before touching the DOM", async () => {
    // A drag begins during the snapshot's I/O, not before it: pressing a chapter
    // row focuses the sidebar leaf (active-leaf-change → rerender), and the drag
    // itself starts a few frames later, while that rerender's snapshot() await is
    // still pending. The entry check alone cannot see that.
    let resolveSnap!: (v: SidebarSnapshot) => void;
    let call = 0;
    const models: SidebarSnapshot[] = [
      { kind: "book", title: "B", chapters: [{ title: "A", status: "ok" }] },
      { kind: "book", title: "B", chapters: [{ title: "Z", status: "ok" }] },
    ];
    const bridge = {
      // Call 1 resolves immediately (baseline render). Call 2 is the one under
      // test: its promise stays pending until the test resolves it by hand. Call
      // 3 (the deferred rerender once the gesture ends) resolves immediately too.
      snapshot: (): Promise<SidebarSnapshot> => {
        call++;
        if (call === 2) return new Promise((resolve) => { resolveSnap = resolve; });
        return Promise.resolve(models[Math.min(call - 1, models.length - 1)]);
      },
      handlers: {
        onExport: () => {},
        onInsertFrontmatter: () => {},
        onConsolidate: () => {},
        onReorder: () => {},
      },
    };
    const view = new EpubHubView(new WorkspaceLeaf() as never, bridge);

    await priv(view).rerender(); // call 1: baseline
    const before = (view.contentEl as unknown as { children: unknown[] }).children;

    const pending = priv(view).rerender(); // call 2: snapshot() now in flight
    priv(view).setDragging(true); // the drag starts mid-await
    resolveSnap(models[1]); // snapshot resolves with a genuinely different model
    await pending;

    // Without the re-check, this continuation would call renderSidebar despite
    // the lock now being held, destroying the row under the pointer.
    expect((view.contentEl as unknown as { children: unknown[] }).children).toBe(before);

    priv(view).setDragging(false); // gesture ends → the deferred rerender runs
    await Promise.resolve();
    await Promise.resolve();
    expect((view.contentEl as unknown as { children: unknown[] }).children).not.toBe(before);
  });
});

describe("EpubHubView · Live-Refresh (M2)", () => {
  function setup(targetPath: string) {
    const md = new MarkdownView();
    const f = new TFile();
    f.path = targetPath;
    md.file = f;

    const registered: Record<string, (arg: unknown) => void> = {};
    const app = {
      workspace: {
        rootSplit: {},
        getMostRecentLeaf: () => ({ view: md }),
        on: (ev: string, fn: (arg: unknown) => void) => { registered[`ws:${ev}`] = fn; return {}; },
      },
      metadataCache: {
        on: (ev: string, fn: (arg: unknown) => void) => { registered[`mc:${ev}`] = fn; return {}; },
      },
    };

    let renders = 0;
    const view = new EpubHubView(new WorkspaceLeaf() as never, {
      snapshot: async () => { renders++; return { kind: "note", title: "A", chapters: [] }; },
      handlers: {
        onExport: () => {}, onInsertFrontmatter: () => {}, onConsolidate: () => {}, onReorder: () => {},
      },
    });
    (view as unknown as { app: unknown }).app = app;
    return { view, registered, renders: () => renders };
  }

  it("re-reads when the note on screen changes on disk", async () => {
    const { view, registered, renders } = setup("Book.md");
    await view.onOpen();
    const before = renders();

    const changed = new TFile();
    changed.path = "Book.md";
    registered["mc:changed"](changed);
    await Promise.resolve();

    expect(renders()).toBeGreaterThan(before);
  });

  it("ignores changes to unrelated notes", async () => {
    const { view, registered, renders } = setup("Book.md");
    await view.onOpen();
    const before = renders();

    const other = new TFile();
    other.path = "Something else.md";
    registered["mc:changed"](other);
    await Promise.resolve();

    expect(renders()).toBe(before);
  });
});
