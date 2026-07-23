import { App, Modal, Setting } from "obsidian";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";
import { t } from "../vendor/kit/i18n";

export interface ConsolidatePreview {
  folderName: string;
  chapterCount: number;
  assetCount: number;
  collision: boolean;
  defaultChapterMode: ChapterMode;
  defaultAssetMode: AssetMode;
}

export class ConsolidateModal extends Modal {
  private chapterMode: ChapterMode;
  private assetMode: AssetMode;

  constructor(
    app: App,
    private preview: ConsolidatePreview,
    private onConfirm: (mode: ChapterMode, assets: AssetMode) => void
  ) {
    super(app);
    this.chapterMode = preview.defaultChapterMode;
    this.assetMode = preview.defaultAssetMode;
  }

  onOpen(): void {
    const { contentEl, preview } = this;
    contentEl.addClass("epub-consolidate-modal");
    contentEl.createEl("h3", { text: t("modal.consolidate.title") });
    contentEl.createEl("p", {
      cls: "epub-consolidate-summary",
      text: t("modal.consolidate.summary", preview.folderName, preview.chapterCount, preview.assetCount),
    });
    if (preview.collision) {
      contentEl.createEl("p", {
        cls: "epub-consolidate-warning",
        text: t("modal.consolidate.collision", preview.folderName),
      });
    }

    new Setting(contentEl)
      .setName(t("settings.consolidateChapter.name"))
      .addDropdown((d) => d
        .addOptions({
          copy: t("settings.consolidateChapter.copy"),
          move: t("settings.consolidateChapter.move"),
        })
        .setValue(this.chapterMode)
        .onChange((v) => { this.chapterMode = v as ChapterMode; }));

    new Setting(contentEl)
      .setName(t("settings.consolidateAsset.name"))
      .addDropdown((d) => d
        .addOptions({
          full: t("settings.consolidateAsset.full"),
          cover: t("settings.consolidateAsset.cover"),
          none: t("settings.consolidateAsset.none"),
        })
        .setValue(this.assetMode)
        .onChange((v) => { this.assetMode = v as AssetMode; }));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("modal.consolidate.cancel")).onClick(() => this.close()))
      .addButton((b) => b
        .setButtonText(t("modal.consolidate.confirm"))
        .setCta()
        .onClick(() => { this.close(); this.onConfirm(this.chapterMode, this.assetMode); }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
