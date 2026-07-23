import { App, ItemView, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import { SidebarSnapshot, buildSidebarModel } from "../core/sidebar-model";
import { renderSidebar, SidebarHandlers } from "./sidebar-render";
import { t } from "../vendor/kit/i18n";

export const VIEW_TYPE_EPUB_HUB = "epub-exporter-hub";

// REGISTRY gotcha Z.91: clicking INTO the sidebar makes the panel the active
// view, so getActiveViewOfType(MarkdownView) returns null. Resolve the user's
// real target note via the most-recent MAIN-area leaf instead.
export function resolveTargetFile(app: App): TFile | null {
  const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
  const view = leaf?.view;
  if (view instanceof MarkdownView && view.file) return view.file;
  return null;
}

export interface SidebarBridge {
  snapshot(): Promise<SidebarSnapshot | null>;
  // The gesture handlers are supplied by the view, not by the plugin: the drag
  // lock is view state, so main.ts has no business knowing about it.
  handlers: Omit<SidebarHandlers, "onDragStart" | "onDragEnd">;
}

// Thin ItemView shell around the node-tested model + renderer. Re-renders on
// every active-leaf/file change so the panel always reflects the current note.
export class EpubHubView extends ItemView {
  // Key of the model currently on screen — lets rerender() skip a redundant DOM
  // rebuild (see rerender for why that matters for click handling).
  private lastModelKey: string | null = null;

  // A rebuild during an in-flight drag would destroy the element under the
  // pointer mid-gesture — the same failure mode that made buttons need two
  // clicks in Plan 4. Requests arriving while locked are deferred, not dropped.
  private dragging = false;
  private pendingRerender = false;

  // Row to focus after the next rebuild — set for keyboard moves only, so a
  // drag never steals focus away from wherever the user was working.
  private focusIndex: number | null = null;

  // A reorder write is not reflected in the DOM until its metadataCache
  // "changed" echo triggers a rerender, so a second reorder request that
  // arrives before the first settles would still find the old row at its old
  // index — repeated Alt+↑/↓ (key-repeat is ~30ms) would replay a stale move
  // and oscillate instead of walking the chapter along. Dropping the second
  // request (not queuing it) is correct: a queued one would still carry the
  // stale index once dequeued. Deliberately NOT gated on focusIndex !== null —
  // that value can legitimately persist across an unrelated rebuild and would
  // wedge the panel.
  private reorderInFlight = false;

  constructor(leaf: WorkspaceLeaf, private bridge: SidebarBridge) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_EPUB_HUB;
  }
  getDisplayText(): string {
    return t("view.title");
  }
  getIcon(): string {
    return "book";
  }

  async onOpen(): Promise<void> {
    await this.rerender();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.rerender()));
    this.registerEvent(this.app.workspace.on("file-open", () => void this.rerender()));
    // M2 (Plan-4 carry-forward): adding or removing an ![[embed]] *inside* the
    // open book note changes the spine without any leaf or file change, so the
    // list would otherwise stay stale until the user switched notes. metadataCache
    // "changed" fires after the cache is updated (unlike vault "modify", which can
    // fire while it's still stale) — buildSnapshot reads the cache, so this is the
    // event that guarantees fresh data. This also covers the echo of our own
    // reorder write — showing the file's actual state is exactly what we want, and
    // the model-key memoisation keeps it free when nothing really changed.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        if (file.path === resolveTargetFile(this.app)?.path) void this.rerender();
      })
    );
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
    this.lastModelKey = null;
    // Cheap insurance alongside onDragEnd: dragend is reliable in Chromium, but
    // there is no cost to also releasing the gesture lock here, so a closed
    // (and possibly later reopened/reused) view can never get stuck locked.
    this.dragging = false;
    this.pendingRerender = false;
  }

  private setDragging(active: boolean): void {
    this.dragging = active;
    if (!active && this.pendingRerender) {
      this.pendingRerender = false;
      void this.rerender();
    }
  }

  private async rerender(): Promise<void> {
    if (this.dragging) {
      this.pendingRerender = true;
      return;
    }
    let snap: SidebarSnapshot | null = null;
    let failed = false;
    try {
      snap = await this.bridge.snapshot();
    } catch (e) {
      console.error("EPUB Exporter: sidebar render failed", e);
      failed = true;
    }

    // The snapshot read above is real I/O (vault.cachedRead) and yields control;
    // a drag can start while it's in flight (pressing a chapter row focuses the
    // sidebar leaf, which fires active-leaf-change and starts a rerender a few
    // frames before the drag itself begins). Re-check the lock on the other side
    // of the await — otherwise this continuation would call renderSidebar and
    // destroy the element under the pointer mid-gesture.
    if (this.dragging) {
      this.pendingRerender = true;
      return;
    }

    // Capture-and-reset must sit exactly here: after both drag-lock checks
    // above, but before the memoisation check below.
    //   - Not earlier: the two lock checks only *defer* the render (they set
    //     pendingRerender and return) — clearing the request there would lose
    //     it before the deferred render gets a chance to honour it.
    //   - Not later: the memoisation check below *discards* the render
    //     outright when the model hasn't changed. A keyboard move can legitimately
    //     produce an unchanged model (reorderChapters no-ops on a conflict or an
    //     out-of-range move, so the file — and hence the model — never changes,
    //     and no metadataCache "changed" event follows to trigger a fresh
    //     rerender). If the capture stayed below that check, this request would
    //     survive as stale state and land on the next rebuild that does get
    //     past it — possibly an unrelated one (e.g. file-open for a different
    //     note), stealing focus onto an arbitrary row the user never touched.
    // The success path is unaffected: a keyboard move that actually wrote to
    // the file produces a changed model, so the following rerender passes the
    // memoisation check below and restores focus as before.
    const focus = this.focusIndex;
    this.focusIndex = null;

    const model = buildSidebarModel(failed ? null : snap);

    // active-leaf-change fires when the user focuses the sidebar itself, but
    // resolveTargetFile reads rootSplit (which excludes sidebars), so the target
    // note — and thus the model — is unchanged. Rebuilding the DOM here would
    // destroy the button under the pointer before its click lands, making every
    // sidebar button need two clicks. Only rebuild when the model actually changed.
    const key = JSON.stringify(model);
    if (key === this.lastModelKey) return;
    this.lastModelKey = key;
    const handlers: SidebarHandlers = {
      ...this.bridge.handlers,
      onReorder: (from, to, expectedCount) => {
        // Drop, don't queue: see the reorderInFlight field comment for why.
        if (this.reorderInFlight) return;
        this.reorderInFlight = true;
        if (!this.dragging) this.focusIndex = to;
        const result = this.bridge.handlers.onReorder(from, to, expectedCount);
        // The delegate (reorderChapters) is responsible for reporting its own
        // failures via Notice; this chain only clears the lock. The `catch`
        // swallows a rejection so it can't surface as an unhandled promise
        // rejection here — `finally` is what guarantees the flag clears
        // regardless of outcome, so a rejected write can't wedge the panel.
        void Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            this.reorderInFlight = false;
          });
      },
      onDragStart: () => this.setDragging(true),
      onDragEnd: () => this.setDragging(false),
    };
    renderSidebar(this.contentEl, model, handlers, focus);
  }
}
