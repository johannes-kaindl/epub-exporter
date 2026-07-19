// src/obsidian/settings-tab.ts
import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EpubExporterSettings, OutputDestination } from "./settings";
import { t } from "../vendor/kit/i18n";

export class EpubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: { settings: EpubExporterSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin as unknown as Plugin);
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
  }
}
