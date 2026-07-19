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
  handlers: SidebarHandlers;
}

// Thin ItemView shell around the node-tested model + renderer. Re-renders on
// every active-leaf/file change so the panel always reflects the current note.
export class EpubHubView extends ItemView {
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
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async rerender(): Promise<void> {
    const snap = await this.bridge.snapshot();
    renderSidebar(this.contentEl, buildSidebarModel(snap), this.bridge.handlers);
  }
}
