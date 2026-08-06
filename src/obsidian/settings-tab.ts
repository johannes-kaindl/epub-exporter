// src/obsidian/settings-tab.ts
import { App, Plugin, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { EpubExporterSettings } from "./settings";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";

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

  // <1.13 fallback: walks the SAME getSettingDefinitions() array the native
  // path reads (Kit walker, vendored in src/vendor/kit-obsidian). Previously
  // this method hand-rebuilt the UI from the classic Setting API, drifting
  // from getSettingDefinitions() — e.g. it alone hid the customFolder row
  // unless outputDestination === "customFolder", a condition the declarative
  // definitions never expressed. Fixed by rendering the one definitions list
  // through both paths; the customFolder row is now always visible with its
  // desc hint on both paths, matching what the native >=1.13 renderer already
  // did (see the comment on that definition above).
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    renderSettingDefinitions(containerEl, this.getSettingDefinitions(), this, this.app);
  }
}
