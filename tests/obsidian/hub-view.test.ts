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

describe("EpubHubView · Fokus-Anfrage ueberlebt keine unbeteiligte Rebuild (Regressionstest)", () => {
  // Same helper shape as the gesture-lock describes above: a book snapshot with
  // canReorder chapters, wired through onReorder so keydown on a rendered row
  // reaches the view's real handler wrapping.
  function viewWith(snaps: SidebarSnapshot[]) {
    let i = 0;
    const bridge = {
      snapshot: async () => snaps[Math.min(i++, snaps.length - 1)],
      handlers: {
        onExport: () => {},
        onInsertFrontmatter: () => {},
        onConsolidate: () => {},
        // Stands in for reorderChapters no-op'ing on a conflict/out-of-range
        // move: the write never happens, so the file (and thus the next
        // snapshot) is unchanged.
        onReorder: () => {},
      },
    };
    return new EpubHubView(new WorkspaceLeaf() as never, bridge);
  }
  const priv = (v: EpubHubView) => v as unknown as { rerender: () => Promise<void> };
  const rowsOf = (v: EpubHubView) =>
    (v.contentEl as unknown as { findAll(cls: string): Array<{ dispatch: (ev: string, p: Record<string, unknown>) => void; focusCount: number }> }).findAll(
      "epub-sb-chapter"
    );

  it("does not leak a stale focus request onto an unrelated later rebuild", async () => {
    const bookA: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Eins", status: "ok" },
        { title: "Zwei", status: "ok" },
      ],
    };
    // A different book entirely, e.g. after the user switched notes (file-open).
    // Three chapters so a stale focusIndex of 1 (from the move below) would
    // land on a row that actually exists here, making the leak observable.
    const bookB: SidebarSnapshot = {
      kind: "book",
      title: "Other",
      chapters: [
        { title: "P", status: "ok" },
        { title: "Q", status: "ok" },
        { title: "R", status: "ok" },
      ],
    };
    const view = viewWith([bookA, bookA, bookB]);

    await priv(view).rerender(); // baseline render of bookA
    const rows = rowsOf(view);

    // Keyboard-originated move: Alt+ArrowDown on row 0 sets a focus request for
    // row 1. The bridge's onReorder is a no-op, so the file never changes.
    rows[0].dispatch("keydown", { key: "ArrowDown", altKey: true });

    // A rerender fires next (e.g. the metadataCache "changed" echo, or an
    // active-leaf-change) but the model is identical, so it bails at the
    // memoisation check.
    await priv(view).rerender();

    // A later, entirely unrelated rerender (a different book, e.g. from
    // switching notes) must not carry the stale request forward.
    await priv(view).rerender();
    const newRows = rowsOf(view);
    for (const r of newRows) expect(r.focusCount).toBe(0);
  });

  it("keeps a focus request alive through a deferred render and honours it once the lock clears", async () => {
    const bookA: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Eins", status: "ok" },
        { title: "Zwei", status: "ok" },
      ],
    };
    // The genuine result of moving "Eins" from 0 to 1 — a real write did
    // happen this time, so the model actually changes.
    const bookAMoved: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Zwei", status: "ok" },
        { title: "Eins", status: "ok" },
      ],
    };
    const view = viewWith([bookA, bookAMoved]);
    const priv2 = view as unknown as { rerender: () => Promise<void>; setDragging: (a: boolean) => void };

    await priv2.rerender(); // baseline render of bookA
    const rows = rowsOf(view);
    rows[0].dispatch("keydown", { key: "ArrowDown", altKey: true }); // sets focus request for row 1

    // A drag starts before the write's "changed" echo arrives.
    priv2.setDragging(true);
    await priv2.rerender(); // deferred: must not drop the pending focus request
    priv2.setDragging(false); // gesture ends → the deferred rerender runs

    await Promise.resolve();
    await Promise.resolve();

    const newRows = rowsOf(view);
    expect(newRows[1].focusCount).toBe(1);
    expect(newRows[0].focusCount).toBe(0);
  });

  it("does not set a focus request when onReorder fires while a drag is active", async () => {
    const bookA: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Eins", status: "ok" },
        { title: "Zwei", status: "ok" },
      ],
    };
    const bookAMoved: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Zwei", status: "ok" },
        { title: "Eins", status: "ok" },
      ],
    };
    const view = viewWith([bookA, bookAMoved]);
    const priv2 = view as unknown as { rerender: () => Promise<void>; setDragging: (a: boolean) => void };

    await priv2.rerender(); // baseline render of bookA
    const rows = rowsOf(view);

    priv2.setDragging(true);
    // The wired onReorder handler guards on `this.dragging`, not on the call
    // site, so dispatching keydown while locked is a faithful, minimal probe
    // for "a reorder arriving mid-drag" without needing a full drop gesture.
    rows[0].dispatch("keydown", { key: "ArrowDown", altKey: true });
    await priv2.rerender(); // deferred by the lock, same as the write's "changed" echo would be

    priv2.setDragging(false); // gesture ends → the deferred rerender runs
    await Promise.resolve();
    await Promise.resolve();

    const newRows = rowsOf(view);
    for (const r of newRows) expect(r.focusCount).toBe(0);
  });
});

describe("EpubHubView · Reorder-in-flight guard (Fix 1)", () => {
  // A snapshot that never changes across renders (kept simple: the model-key
  // memoisation means later rerenders here are no-ops, which is fine — these
  // tests dispatch directly on the rows from the one baseline render, exactly
  // like a stale keypress landing on a not-yet-rebuilt row in production).
  const bookA: SidebarSnapshot = {
    kind: "book",
    title: "B",
    chapters: [
      { title: "Eins", status: "ok" },
      { title: "Zwei", status: "ok" },
    ],
  };

  function viewWithOnReorder(onReorder: (from: number, to: number, expectedCount: number) => Promise<void> | void) {
    const bridge = {
      snapshot: async () => bookA,
      handlers: { onExport: () => {}, onInsertFrontmatter: () => {}, onConsolidate: () => {}, onReorder },
    };
    return new EpubHubView(new WorkspaceLeaf() as never, bridge);
  }
  const priv = (v: EpubHubView) => v as unknown as { rerender: () => Promise<void> };
  const rowsOf = (v: EpubHubView) =>
    (v.contentEl as unknown as { findAll(cls: string): Array<{ dispatch: (ev: string, p: Record<string, unknown>) => void }> }).findAll(
      "epub-sb-chapter"
    );
  const altDown = (row: { dispatch: (ev: string, p: Record<string, unknown>) => void }) =>
    row.dispatch("keydown", { key: "ArrowDown", altKey: true });

  it("drops a second reorder request that arrives while the first is still in flight", async () => {
    const calls: Array<[number, number, number]> = [];
    let resolveFirst!: () => void;
    const onReorder = (from: number, to: number, count: number): Promise<void> => {
      calls.push([from, to, count]);
      return new Promise((resolve) => { resolveFirst = resolve; });
    };
    const view = viewWithOnReorder(onReorder);
    await priv(view).rerender();
    const rows = rowsOf(view);

    altDown(rows[0]); // first request: goes through, promise stays pending
    altDown(rows[0]); // stale repeat on the same (not-yet-rebuilt) row: must be dropped

    expect(calls).toEqual([[0, 1, 2]]);
    resolveFirst();
  });

  it("lets a further request through once the in-flight one has settled", async () => {
    const calls: Array<[number, number, number]> = [];
    let pending: Array<() => void> = [];
    const onReorder = (from: number, to: number, count: number): Promise<void> => {
      calls.push([from, to, count]);
      return new Promise((resolve) => { pending.push(resolve); });
    };
    const view = viewWithOnReorder(onReorder);
    await priv(view).rerender();
    const rows = rowsOf(view);

    altDown(rows[0]);
    expect(calls).toHaveLength(1);

    pending[0](); // first request settles
    await Promise.resolve();
    await Promise.resolve();

    altDown(rows[0]); // now allowed through again
    expect(calls).toHaveLength(2);
  });

  it("clears the in-flight flag even when the delegated write rejects", async () => {
    const calls: Array<[number, number, number]> = [];
    let rejectFirst!: (e: Error) => void;
    const onReorder = (from: number, to: number, count: number): Promise<void> => {
      calls.push([from, to, count]);
      return new Promise((_resolve, reject) => { rejectFirst = reject; });
    };
    const view = viewWithOnReorder(onReorder);
    await priv(view).rerender();
    const rows = rowsOf(view);

    altDown(rows[0]);
    expect(calls).toHaveLength(1);

    rejectFirst(new Error("write failed"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    altDown(rows[0]); // flag must be clear despite the rejection, or this would be dropped
    expect(calls).toHaveLength(2);
  });

  it("re-renders as soon as the write settles, without waiting for a metadataCache 'changed' echo (Fix 1)", async () => {
    // Two distinct snapshots: the first render sees bookA, and every render
    // after the write resolves sees bookAMoved. If the panel only refreshed on
    // the metadataCache echo (never fired in this test), it would still show
    // bookA's two rows; refreshing on settle instead should already show the
    // post-move three rows.
    const bookAMoved: SidebarSnapshot = {
      kind: "book",
      title: "B",
      chapters: [
        { title: "Zwei", status: "ok" },
        { title: "Eins", status: "ok" },
        { title: "Drei", status: "ok" },
      ],
    };
    let resolveWrite!: () => void;
    let snapCalls = 0;
    const bridge = {
      snapshot: async (): Promise<SidebarSnapshot> => {
        snapCalls++;
        return snapCalls === 1 ? bookA : bookAMoved;
      },
      handlers: {
        onExport: () => {},
        onInsertFrontmatter: () => {},
        onConsolidate: () => {},
        onReorder: (): Promise<void> => new Promise((resolve) => { resolveWrite = resolve; }),
      },
    };
    const view = new EpubHubView(new WorkspaceLeaf() as never, bridge);
    await priv(view).rerender(); // baseline render of bookA
    const rows = rowsOf(view);

    altDown(rows[0]); // fires onReorder, write promise stays pending
    // No metadataCache "changed" event is ever dispatched in this test — the
    // only thing that can produce the refresh is the .finally() on settle.
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const rowsAfter = (
      view.contentEl as unknown as { findAll(cls: string): Array<{ dispatch: (ev: string, p: Record<string, unknown>) => void }> }
    ).findAll("epub-sb-chapter");
    expect(rowsAfter).toHaveLength(3);
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
