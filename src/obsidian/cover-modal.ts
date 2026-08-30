import { App, Modal, Setting, setIcon } from "obsidian";
import {
  coverSizeOptions,
  defaultCoverSize,
  type CoverSize,
  type ImageApiStatus,
} from "../core/image-api";
import { t } from "../vendor/kit/i18n";

export interface CoverModalInput {
  /** Prompt to start from: the note's `cover_prompt`, or one built from its title. */
  prompt: string;
  /** Whether the book already has a cover — shown as a warning, never as a block. */
  hasCover: boolean;
  status: ImageApiStatus;
}

export interface CoverModalChoice {
  prompt: string;
  size: CoverSize;
}

const SIZE_SEP = "x";

/**
 * Asks what the cover should show, then hands the choice back and stays open to
 * report progress.
 *
 * Two things it deliberately does NOT do: offer controls the backend cannot
 * honour (sizes come from `capabilities`, and there is no CFG or negative-prompt
 * field because the builtin engine ignores both), and block on an existing
 * cover. Replacing one is the user's call; the modal says so and moves on.
 */
export class CoverModal extends Modal {
  private prompt: string;
  private size: CoverSize;
  private statusEl: HTMLElement | null = null;
  private statusIcon: HTMLElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private input: CoverModalInput,
    private onConfirm: (choice: CoverModalChoice, modal: CoverModal) => void
  ) {
    super(app);
    this.prompt = input.prompt;
    this.size = defaultCoverSize(input.status.capabilities);
  }

  onOpen(): void {
    const { contentEl, input } = this;
    contentEl.addClass("epub-cover-modal");
    contentEl.createEl("h3", { text: t("modal.cover.title") });

    if (input.hasCover) {
      contentEl.createEl("p", {
        cls: "epub-cover-warning",
        text: t("modal.cover.replaceWarning"),
      });
    }

    new Setting(contentEl)
      .setName(t("modal.cover.prompt"))
      .setDesc(t("modal.cover.promptDesc"))
      .addTextArea((ta) => {
        ta.setValue(this.prompt).onChange((v) => { this.prompt = v; });
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("epub-cover-prompt");
      });

    const sizes = coverSizeOptions(input.status.capabilities);
    // A single allowed size is a fact, not a choice — sd-turbo does 512x512 and
    // nothing else. A dropdown with one entry would be a control that pretends.
    if (sizes.length > 1) {
      const options: Record<string, string> = {};
      for (const s of sizes) options[`${s.width}${SIZE_SEP}${s.height}`] = `${s.width} × ${s.height}`;
      new Setting(contentEl)
        .setName(t("modal.cover.size"))
        .addDropdown((d) => d
          .addOptions(options)
          .setValue(`${this.size.width}${SIZE_SEP}${this.size.height}`)
          .onChange((v) => {
            const [w, h] = v.split(SIZE_SEP).map(Number);
            this.size = { width: w, height: h };
          }));
    }

    // Status line, following UI-STANDARD §8: state carried by icon AND colour
    // AND class AND aria-label, never colour alone.
    const row = contentEl.createDiv({ cls: "epub-cover-status is-ok" });
    this.statusIcon = row.createSpan({ cls: "epub-cover-status-icon" });
    this.statusEl = row.createSpan({ cls: "epub-cover-status-text" });
    setIcon(this.statusIcon, "circle-check");
    this.setStatus("is-ok", "circle-check", t("modal.cover.ready", input.status.engine));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("modal.cover.cancel")).onClick(() => this.close()))
      .addButton((b) => {
        this.generateBtn = b.buttonEl;
        return b
          .setButtonText(t("modal.cover.generate"))
          .setCta()
          .onClick(() => {
            // Stays open: generation can take minutes on the builtin engine, and
            // a closed modal would leave the user with no sign that it is running.
            b.setDisabled(true);
            this.setStatus("is-checking", "loader", t("modal.cover.checking"));
            this.onConfirm({ prompt: this.prompt, size: this.size }, this);
          });
      });
  }

  /** Progress callback for the provider — safe to call after the modal closed. */
  reportProgress(pct: number | null, phase: "loading-model" | "generating"): void {
    if (phase === "loading-model") {
      this.setStatus("is-checking", "loader", t("modal.cover.loadingModel"));
      return;
    }
    const shown = pct === null ? "…" : `${Math.round(pct)}%`;
    this.setStatus("is-checking", "loader", t("modal.cover.generating", shown));
  }

  /** Puts the modal back into a usable state after a failed run. */
  reportFailure(message: string): void {
    this.setStatus("is-error", "circle-x", message);
    this.generateBtn?.removeAttribute("disabled");
  }

  private setStatus(state: string, icon: string, text: string): void {
    const row = this.statusEl?.parentElement;
    if (!row || !this.statusIcon || !this.statusEl) return;
    row.removeClasses(["is-ok", "is-checking", "is-error", "is-warning"]);
    row.addClass(state);
    row.setAttribute("aria-label", text);
    setIcon(this.statusIcon, icon);
    this.statusEl.setText(text);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
