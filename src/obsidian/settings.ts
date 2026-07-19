import { mergeSettings } from "../vendor/kit/settings";

export type OutputDestination =
  | "besideNote"
  | "attachmentFolder"
  | "customFolder"
  | "share";

export interface EpubExporterSettings {
  outputDestination: OutputDestination;
  customFolder: string;
  openSidebarOnStartup: boolean;
  defaultLanguage: string;
}

export const DEFAULT_SETTINGS: EpubExporterSettings = {
  outputDestination: "besideNote",
  customFolder: "",
  openSidebarOnStartup: false,
  defaultLanguage: "en",
};

// Merge persisted data (from Plugin.loadData()) onto the defaults without
// mutating DEFAULT_SETTINGS (one-level-deep clone via the kit helper).
export function coerceSettings(raw: unknown): EpubExporterSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
