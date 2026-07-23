// src/obsidian/settings-tab.ts
import { App, Plugin, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { EpubExporterSettings, OutputDestination } from "./settings";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";
import { t } from "../vendor/kit/i18n";

export class EpubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: { settings: EpubExporterSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin as unknown as Plugin);
  }

  // Declarative settings (Obsidian 1.13+): drives both rendering and the
  // settings-search index. On 1.13+ this fully replaces display() below; we
  // keep display() because manifest minAppVersion is < 1.13.0 and older
  // Obsidian ignores this method.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.output.name"),
        control: {
          type: "dropdown",
          key: "outputDestination",
          options: {
            besideNote: t("settings.output.besideNote"),
            attachmentFolder: t("settings.output.attachmentFolder"),
            customFolder: t("settings.output.customFolder"),
            share: t("settings.output.share"),
          },
        },
      },
      {
        // Always shown (not gated on the output mode): toggling visibility
        // needs the 1.13-only refreshDomState/update APIs, which we cannot call
        // at minAppVersion 1.8.7. A desc hint carries the "only when custom
        // folder" context instead. The <1.13 display() fallback keeps the
        // conditional row for older Obsidian.
        name: t("settings.customFolder.name"),
        desc: t("settings.customFolder.desc"),
        control: { type: "text", key: "customFolder" },
      },
      {
        // Dropdown, not free text: only the languages the plugin ships UI
        // strings for (de/en); labels shown in their own language.
        name: t("settings.language.name"),
        desc: t("settings.language.desc"),
        control: {
          type: "dropdown",
          key: "defaultLanguage",
          options: { en: "English", de: "Deutsch" },
        },
      },
      {
        name: t("settings.openSidebar.name"),
        desc: t("settings.openSidebar.desc"),
        control: { type: "toggle", key: "openSidebarOnStartup" },
      },
      {
        name: t("settings.consolidateChapter.name"),
        desc: t("settings.consolidateChapter.desc"),
        control: {
          type: "dropdown",
          key: "consolidateChapterMode",
          options: {
            copy: t("settings.consolidateChapter.copy"),
            move: t("settings.consolidateChapter.move"),
          },
        },
      },
      {
        name: t("settings.consolidateAsset.name"),
        desc: t("settings.consolidateAsset.desc"),
        control: {
          type: "dropdown",
          key: "consolidateAssetMode",
          options: {
            full: t("settings.consolidateAsset.full"),
            cover: t("settings.consolidateAsset.cover"),
            none: t("settings.consolidateAsset.none"),
          },
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    // Coerce any legacy free-text language value to a valid dropdown option.
    if (key === "defaultLanguage") return s.defaultLanguage === "de" ? "de" : "en";
    return (s as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    s[key] = key === "customFolder" ? String(value).trim() : value;
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl).setName(t("settings.output.name")).addDropdown((d) =>
      d
        .addOptions({
          besideNote: t("settings.output.besideNote"),
          attachmentFolder: t("settings.output.attachmentFolder"),
          customFolder: t("settings.output.customFolder"),
          share: t("settings.output.share"),
        })
        .setValue(s.outputDestination)
        .onChange(async (v) => {
          s.outputDestination = v as OutputDestination;
          await save();
          // The custom-folder row is conditional on the mode; re-render is Obsidian's
          // supported way to show/hide dependent settings.
          this.display();
        })
    );

    // Only visible in the matching mode — so it needs no "only when X" helper text.
    if (s.outputDestination === "customFolder") {
      new Setting(containerEl)
        .setName(t("settings.customFolder.name"))
        .addText((txt) => txt.setValue(s.customFolder).onChange(async (v) => {
          s.customFolder = v.trim();
          await save();
        }));
    }

    // Dropdown, not free text: only the languages the plugin actually ships
    // UI strings for (de/en). Labels are shown in their own language, unlocalised.
    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((d) => d
        .addOptions({ en: "English", de: "Deutsch" })
        // Coerce any legacy free-text value to a valid option for display.
        .setValue(s.defaultLanguage === "de" ? "de" : "en")
        .onChange(async (v) => {
          s.defaultLanguage = v;
          await save();
        }));

    new Setting(containerEl)
      .setName(t("settings.openSidebar.name"))
      .setDesc(t("settings.openSidebar.desc"))
      .addToggle((tg) => tg.setValue(s.openSidebarOnStartup).onChange(async (v) => {
        s.openSidebarOnStartup = v;
        await save();
      }));

    new Setting(containerEl)
      .setName(t("settings.consolidateChapter.name"))
      .setDesc(t("settings.consolidateChapter.desc"))
      .addDropdown((d) => d
        .addOptions({
          copy: t("settings.consolidateChapter.copy"),
          move: t("settings.consolidateChapter.move"),
        })
        .setValue(s.consolidateChapterMode)
        .onChange(async (v) => { s.consolidateChapterMode = v as ChapterMode; await save(); }));

    new Setting(containerEl)
      .setName(t("settings.consolidateAsset.name"))
      .setDesc(t("settings.consolidateAsset.desc"))
      .addDropdown((d) => d
        .addOptions({
          full: t("settings.consolidateAsset.full"),
          cover: t("settings.consolidateAsset.cover"),
          none: t("settings.consolidateAsset.none"),
        })
        .setValue(s.consolidateAssetMode)
        .onChange(async (v) => { s.consolidateAssetMode = v as AssetMode; await save(); }));
  }
}
