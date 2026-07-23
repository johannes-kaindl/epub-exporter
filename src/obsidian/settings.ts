import { mergeSettings } from "../vendor/kit/settings";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";

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
  consolidateChapterMode: ChapterMode;
  consolidateAssetMode: AssetMode;
}

export const DEFAULT_SETTINGS: EpubExporterSettings = {
  outputDestination: "besideNote",
  customFolder: "",
  openSidebarOnStartup: false,
  defaultLanguage: "en",
  consolidateChapterMode: "copy",
  consolidateAssetMode: "full",
};

// Merge persisted data (from Plugin.loadData()) onto the defaults without
// mutating DEFAULT_SETTINGS (one-level-deep clone via the kit helper).
export function coerceSettings(raw: unknown): EpubExporterSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
