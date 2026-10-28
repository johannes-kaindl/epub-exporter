import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS, toFolderBookOptions } from "../../src/obsidian/settings";

describe("coerceSettings", () => {
  it("returns defaults for null/undefined/non-object", () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("overlays stored values onto defaults", () => {
    const s = coerceSettings({ outputDestination: "share", customFolder: "Books" });
    expect(s.outputDestination).toBe("share");
    expect(s.customFolder).toBe("Books");
    expect(s.openSidebarOnStartup).toBe(false); // default preserved
  });

  it("does not mutate DEFAULT_SETTINGS", () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    coerceSettings({ customFolder: "X" });
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});

describe("folder book settings", () => {
  it("defaults: no number rule, no intro names, titles from the heading, no work directory, no work copy", () => {
    expect(DEFAULT_SETTINGS.folderNumberPrefix).toBe(false);
    expect(DEFAULT_SETTINGS.folderIntroNames).toBe("");
    expect(DEFAULT_SETTINGS.folderPageTitle).toBe("heading");
    expect(DEFAULT_SETTINGS.workDir).toBe("");
    expect(DEFAULT_SETTINGS.useWorkCopy).toBe(false);
  });

  it("keeps stored values and fills the new keys on old data", () => {
    const stored = coerceSettings({ folderNumberPrefix: true, workDir: "Arbeit", folderIntroNames: "README", folderPageTitle: "filename", useWorkCopy: true });
    expect(stored).toMatchObject({ folderNumberPrefix: true, workDir: "Arbeit", folderIntroNames: "README", folderPageTitle: "filename", useWorkCopy: true });
    const old = coerceSettings({ outputDestination: "share" });
    expect(old.folderPageTitle).toBe("heading");
    expect(old.useWorkCopy).toBe(false);
  });

  it("toFolderBookOptions splits the intro names and reads the title choice", () => {
    const options = toFolderBookOptions({ ...DEFAULT_SETTINGS, folderNumberPrefix: true, folderIntroNames: " README , {{folder_name}},, ", folderPageTitle: "heading" });
    expect(options).toEqual({ numberPrefix: true, introNames: ["README", "{{folder_name}}"], titleFromHeading: true });
    expect(toFolderBookOptions({ ...DEFAULT_SETTINGS, folderPageTitle: "filename" }).titleFromHeading).toBe(false);
    expect(toFolderBookOptions(DEFAULT_SETTINGS)).toEqual({ numberPrefix: false, introNames: [], titleFromHeading: true });
  });
});
