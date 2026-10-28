import { setIcon, Platform } from "obsidian";
import { FolderPreview, SidebarModel } from "../core/sidebar-model";
import { t } from "../vendor/kit/i18n";

export interface SidebarHandlers {
  onExport(): void;
  onInsertFrontmatter(): void;
  onConsolidate(): void;
  // Optional: panels built before the cover feature existed do not pass it.
  onGenerateCover?(): void;
  // `expectedCount` travels with the request so the writer can detect that the
  // note changed behind the panel's back without re-reading it first.
  // Returns the write's promise (or nothing, for callers that don't need it)
  // so the view can serialise repeated requests against the file round-trip.
  onReorder(from: number, to: number, expectedCount: number): Promise<void> | void;
  onDragStart(): void;
  onDragEnd(): void;
  // The folder mode (right-click on a folder). Optional like onGenerateCover: a panel built
  // without a folder selection never draws these buttons, so it has no handler to pass.
  onFolderExport?(): void;
  onFolderToggleWorkCopy?(): void;
  onFolderCreateWorkCopy?(): void;
  onFolderImport?(): void;
  onFolderClose?(): void;
}

// Indentation stops here: a deeper row keeps its place in the list but not a deeper step, so the
// panel (about 250px wide) never pushes a title out of sight. styles.css has one rule per step.
const MAX_INDENT_DEPTH = 6;

/** The sentence for each reason there is no working copy; the sidebar shows it, and so does a click that would have made one. */
export const NO_COPY_TEXT = {
  "no-workdir": "view.folder.copyNo.noWorkdir",
  "invalid-workdir": "view.folder.copyNo.invalidWorkdir",
  "inside-workdir": "view.folder.copyNo.insideWorkdir",
  "contains-workdir": "view.folder.copyNo.containsWorkdir",
} as const;

function headerTitle(context: SidebarModel["context"]): string {
  if (context === "book") return t("view.context.book");
  if (context === "note") return t("view.context.note");
  if (context === "folder") return t("view.context.folder");
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
  setIcon(icon, model.context === "folder" ? "folder" : "book");
  header.createSpan({ cls: "epub-sb-title", text: headerTitle(model.context) });
  if (model.context === "folder") {
    // The only way out of the folder mode besides right-clicking another folder: it ends by an explicit act,
    // not by switching the active note. An icon button, its name is the aria-label (setIcon renders no text).
    const close = header.createEl("button", {
      cls: "clickable-icon epub-sb-action-close",
      attr: { "aria-label": t("view.folder.close") },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => handlers.onFolderClose?.());
  }

  if (model.context === "none") {
    root.createDiv({ cls: "epub-sb-empty", text: t("view.empty") });
    // The way in for someone who has no book note yet: a sentence, not a button (UI-STANDARD § 8
    // Empty-State). The command name is the palette's own string, so the two cannot drift apart.
    root.createDiv({ cls: "epub-sb-empty epub-sb-empty-hint", text: t("view.emptyHint", t("cmd.insertFrontmatter")) });
    return;
  }

  root.createDiv({ cls: "epub-sb-subtitle", text: model.title });

  if (model.context === "folder") {
    if (model.folder) renderFolder(root, model.folder, handlers);
    return;
  }

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

    // Neither half of the reorder gesture exists on mobile: HTML5 drag-and-drop
    // never fires from touch input in either mobile WebView, and Alt+↑/↓ needs a
    // hardware keyboard. Showing the grip/hint there advertises a gesture the
    // user cannot perform, so the whole affordance — grip, hint, draggable,
    // and the drag/keyboard listeners — is suppressed on mobile even when the
    // model says the note itself is reorderable.
    const reorderable = model.canReorder && !Platform.isMobile;

    model.chapters.forEach((ch, index) => {
      const li = list.createEl("li", { cls: "epub-sb-chapter" });
      rows.push(li);
      if (ch.status === "missing") li.addClass("is-missing");

      if (reorderable) {
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

      if (!reorderable) return;

      li.addEventListener("dragstart", (e) => {
        dragFrom = index;
        li.addClass("is-dragging");
        const dt = e.dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          // A plugin-private MIME type, not "text/plain": the book note is
          // typically open in the editor right next to this ~250px panel, and
          // an overshot drag that releases over CodeMirror would otherwise have
          // its text/plain payload pasted straight into the note as a stray
          // digit. No editor pastes a type it doesn't recognise, so this is
          // effectively inert outside this list. The in-memory `dragFrom`
          // closure is what the drop handler actually reads; this call only
          // exists so the drag itself starts.
          dt.setData("application/x-epub-exporter-chapter", String(index));
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
    // Conditional on purpose: the image provider is an optional neighbouring
    // plugin that can be disabled while Obsidian runs, so this button appears
    // and disappears with it rather than sitting there unable to work.
    if (model.canGenerateCover) {
      const coverBtn = root.createEl("button", {
        cls: "epub-sb-btn epub-sb-action-cover",
        text: t("view.generateCover"),
      });
      coverBtn.addEventListener("click", () => handlers.onGenerateCover?.());
    }
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

function renderFolder(root: HTMLElement, folder: FolderPreview, handlers: SidebarHandlers): void {
  const onCopy = folder.workCopy.available && folder.workCopy.enabled && folder.workCopy.exists;
  // The panel always says what it reads from, because with the copy on the original is no longer the book.
  root.createDiv({
    cls: "epub-sb-source",
    text: t(onCopy ? "view.folder.sourceCopy" : "view.folder.sourceOriginal", folder.sourcePath),
  });
  root.createDiv({ cls: "epub-sb-hint", text: t("view.folder.hint") });

  if (folder.rows.length === 0) {
    root.createDiv({ cls: "epub-sb-empty", text: t("view.folder.empty") });
  } else {
    const list = root.createEl("ul", { cls: "epub-sb-tree" });
    for (const row of folder.rows) {
      const li = list.createEl("li", {
        cls: "epub-sb-row",
        attr: { "data-depth": String(Math.min(row.depth, MAX_INDENT_DEPTH)) },
      });
      const icon = li.createSpan({ cls: "epub-sb-row-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, row.kind === "chapter" ? "folder" : "file-text");
      li.createSpan({ cls: "epub-sb-row-title", text: row.title });
    }
  }

  if (folder.hiddenCount > 0) {
    const hidden = root.createDiv({ cls: "epub-sb-hidden" });
    setIcon(hidden.createSpan({ cls: "epub-sb-hidden-icon", attr: { "aria-hidden": "true" } }), "eye-off");
    hidden.createSpan({ text: t("view.folder.hidden", folder.hiddenCount) });
  }

  const copy = folder.workCopy;
  if (!copy.available) {
    root.createDiv({ cls: "epub-sb-copy-note", text: t(NO_COPY_TEXT[copy.reason]) });
  } else {
    // A state button (UI-STANDARD § 8): the label names the actual state, the action only follows after a dash;
    // the state also sits in aria-pressed, so no state rests on colour alone.
    const label = t(copy.enabled ? "view.folder.copyOn" : "view.folder.copyOff");
    const toggle = root.createEl("button", {
      cls: "epub-sb-btn epub-sb-action-copy-toggle",
      text: label,
      attr: {
        "aria-pressed": String(copy.enabled),
        title: `${label} \u2014 ${t(copy.enabled ? "view.folder.copyClickOff" : "view.folder.copyClickOn")}`,
      },
    });
    toggle.addEventListener("click", () => handlers.onFolderToggleWorkCopy?.());
    if (copy.enabled && !copy.exists) {
      root.createDiv({ cls: "epub-sb-copy-note", text: t("view.folder.copyMissing", copy.path) });
      const create = root.createEl("button", {
        cls: "epub-sb-btn epub-sb-action-copy-create",
        text: t("view.folder.createCopy"),
      });
      create.addEventListener("click", () => handlers.onFolderCreateWorkCopy?.());
    }
  }

  const exportBtn = root.createEl("button", { cls: "epub-sb-btn mod-cta epub-sb-action-export", text: t("view.export") });
  exportBtn.addEventListener("click", () => handlers.onFolderExport?.());
  const importBtn = root.createEl("button", { cls: "epub-sb-btn epub-sb-action-import", text: t("view.folder.import") });
  importBtn.addEventListener("click", () => handlers.onFolderImport?.());
}
