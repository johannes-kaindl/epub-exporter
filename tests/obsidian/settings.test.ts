import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS } from "../../src/obsidian/settings";

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
