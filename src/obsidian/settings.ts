import { mergeSettings } from "../vendor/kit/settings";
import { ChapterMode, AssetMode } from "../core/consolidate-plan";
import type { FolderBookOptions } from "../core/folder-tree";
import { splitList } from "../vendor/kit/split-list";

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
  /** Read a number in front of a folder or note name as its order, and a 0 as "hide". */
  folderNumberPrefix: boolean;
  /** Comma-separated names of the page that opens a folder chapter; `{{folder_name}}` allowed. */
  folderIntroNames: string;
  /** A page's title in a folder book: its first heading, or its file name. */
  folderPageTitle: "heading" | "filename";
  /** Vault folder that holds working copies of exported folders; empty = no working copy possible. */
  workDir: string;
  /** Export from the working copy instead of the original folder. */
  useWorkCopy: boolean;
}

export const DEFAULT_SETTINGS: EpubExporterSettings = {
  outputDestination: "besideNote",
  customFolder: "",
  openSidebarOnStartup: false,
  defaultLanguage: "en",
  consolidateChapterMode: "copy",
  consolidateAssetMode: "full",
  folderNumberPrefix: false,
  folderIntroNames: "",
  folderPageTitle: "heading",
  workDir: "",
  useWorkCopy: false,
};

// Merge persisted data (from Plugin.loadData()) onto the defaults without
// mutating DEFAULT_SETTINGS (one-level-deep clone via the kit helper).
export function coerceSettings(raw: unknown): EpubExporterSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}

/** The options the folder export reads from the settings. */
export function toFolderBookOptions(s: EpubExporterSettings): FolderBookOptions {
  return {
    numberPrefix: s.folderNumberPrefix,
    introNames: splitList(s.folderIntroNames),
    titleFromHeading: s.folderPageTitle === "heading",
  };
}
