import { setIcon } from "obsidian";
import { SidebarModel } from "../core/sidebar-model";
import { t } from "../vendor/kit/i18n";

export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
  onConsolidate(): void;
}

function headerTitle(context: SidebarModel["context"]): string {
  if (context === "book") return t("view.context.book");
  if (context === "note") return t("view.context.note");
  return t("view.none.title");
}

// Pure DOM build (mount-once): clears root and rebuilds from the model. Buttons
// are wired to injected handlers so this stays node-testable with the fake el.
export function renderSidebar(root: HTMLElement, model: SidebarModel, handlers: SidebarHandlers): void {
  root.empty();
  root.addClass("epub-exporter-sidebar");

  const header = root.createDiv({ cls: "epub-sb-header" });
  const icon = header.createSpan({ cls: "epub-sb-icon" });
  setIcon(icon, "book");
  header.createSpan({ cls: "epub-sb-title", text: headerTitle(model.context) });

  if (model.context === "none") {
    root.createDiv({ cls: "epub-sb-empty", text: t("view.empty") });
    return;
  }

  root.createDiv({ cls: "epub-sb-subtitle", text: model.title });

  if (model.context === "book") {
    root.createDiv({ cls: "epub-sb-chapters-label", text: t("view.chaptersLabel") });
    const list = root.createEl("ul", { cls: "epub-sb-chapters" });
    for (const ch of model.chapters) {
      const li = list.createEl("li", { cls: "epub-sb-chapter" });
      if (ch.status === "missing") li.addClass("is-missing");
      const status = li.createSpan({ cls: "epub-sb-chapter-status" });
      setIcon(status, ch.status === "ok" ? "check" : "alert-triangle");
      li.createSpan({ cls: "epub-sb-chapter-title", text: ch.title });
    }
    if (model.missingCount > 0) {
      root.createDiv({ cls: "epub-sb-warning", text: t("view.missing", model.missingCount) });
    }

    const exportBtn = root.createEl("button", {
      cls: "epub-sb-btn mod-cta epub-sb-action-export",
      text: t("view.export"),
    });
    exportBtn.addEventListener("click", () => handlers.onExport());
    const metaBtn = root.createEl("button", {
      cls: "epub-sb-btn epub-sb-action-meta",
      text: t("view.editMetadata"),
    });
    metaBtn.addEventListener("click", () => handlers.onInsertFrontmatter());
    const consolidateBtn = root.createEl("button", {
      cls: "epub-sb-btn epub-sb-action-consolidate",
      text: t("view.consolidate"),
    });
    consolidateBtn.addEventListener("click", () => handlers.onConsolidate());
    return;
  }

  // context === "note"
  const exportBtn = root.createEl("button", {
    cls: "epub-sb-btn mod-cta epub-sb-action-export",
    text: t("view.exportNote"),
  });
  exportBtn.addEventListener("click", () => handlers.onExport());
  const makeBtn = root.createEl("button", {
    cls: "epub-sb-btn epub-sb-action-meta",
    text: t("view.makeBook"),
  });
  makeBtn.addEventListener("click", () => handlers.onInsertFrontmatter());
}
