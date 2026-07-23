import { setIcon } from "obsidian";
import { SidebarModel } from "../core/sidebar-model";
import { t } from "../vendor/kit/i18n";

export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
  onConsolidate(): void;
  // `expectedCount` travels with the request so the writer can detect that the
  // note changed behind the panel's back without re-reading it first.
  // Returns the write's promise (or nothing, for callers that don't need it)
  // so the view can serialise repeated requests against the file round-trip.
  onReorder(from: number, to: number, expectedCount: number): Promise<void> | void;
  onDragStart(): void;
  onDragEnd(): void;
}

function headerTitle(context: SidebarModel["context"]): string {
  if (context === "book") return t("view.context.book");
  if (context === "note") return t("view.context.note");
  return t("view.none.title");
}

// Pure DOM build (mount-once): clears root and rebuilds from the model. Buttons
// are wired to injected handlers so this stays node-testable with the fake el.
export function renderSidebar(
  root: HTMLElement,
  model: SidebarModel,
  handlers: SidebarHandlers,
  focusIndex: number | null = null
): void {
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

    // Source index of the row currently being dragged. Kept in this closure
    // rather than in dataTransfer: it survives without any DOM round-trip and
    // keeps the handlers node-testable.
    let dragFrom: number | null = null;
    const rows: HTMLElement[] = [];
    const clearMarks = (): void => {
      for (const el of rows) {
        el.removeClass("is-dragging");
        el.removeClass("is-drop-target");
      }
    };

    model.chapters.forEach((ch, index) => {
      const li = list.createEl("li", { cls: "epub-sb-chapter" });
      rows.push(li);
      if (ch.status === "missing") li.addClass("is-missing");

      if (model.canReorder) {
        li.draggable = true;
        li.setAttribute("tabindex", "0");
        // The grip is a decorative icon (aria-hidden), so its title would be
        // invisible to assistive tech; the hint belongs on the row itself, which
        // is the focusable, draggable element a screen reader actually exposes.
        li.setAttribute("title", t("view.dragHint"));
        const grip = li.createSpan({
          cls: "epub-sb-chapter-grip",
          attr: { "aria-hidden": "true" },
        });
        setIcon(grip, "grip-vertical");
      }

      const status = li.createSpan({ cls: "epub-sb-chapter-status" });
      setIcon(status, ch.status === "ok" ? "check" : "alert-triangle");
      li.createSpan({ cls: "epub-sb-chapter-title", text: ch.title });

      if (!model.canReorder) return;

      li.addEventListener("dragstart", (e) => {
        dragFrom = index;
        li.addClass("is-dragging");
        // Firefox refuses to start a drag unless some data is set.
        const dt = e.dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          dt.setData("text/plain", String(index));
        }
        handlers.onDragStart();
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault(); // without this the drop event never fires
        if (dragFrom !== null && dragFrom !== index) li.addClass("is-drop-target");
      });
      li.addEventListener("dragleave", () => li.removeClass("is-drop-target"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = dragFrom;
        dragFrom = null;
        clearMarks();
        // The renderer stays fire-and-forget here: serialising against the
        // write's promise is the view's job (hub-view's reorderInFlight guard
        // wraps this same handler), not the DOM layer's.
        if (from !== null && from !== index) void handlers.onReorder(from, index, model.chapters.length);
      });
      li.addEventListener("dragend", () => {
        dragFrom = null;
        clearMarks();
        handlers.onDragEnd();
      });
      li.addEventListener("keydown", (e) => {
        if (!e.altKey) return;
        if (e.key === "ArrowUp" && index > 0) {
          e.preventDefault();
          void handlers.onReorder(index, index - 1, model.chapters.length);
        } else if (e.key === "ArrowDown" && index < model.chapters.length - 1) {
          e.preventDefault();
          void handlers.onReorder(index, index + 1, model.chapters.length);
        }
      });
    });

    // The rebuild replaced the DOM, so the row the user was on is gone. Restore
    // focus, otherwise a second Alt+Arrow press would have nothing to act on.
    if (focusIndex !== null) rows[focusIndex]?.focus();

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
