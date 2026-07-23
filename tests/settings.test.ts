import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS } from "../src/obsidian/settings";

describe("consolidate settings defaults", () => {
  it("defaults chapter mode to copy and asset mode to full", () => {
    expect(DEFAULT_SETTINGS.consolidateChapterMode).toBe("copy");
    expect(DEFAULT_SETTINGS.consolidateAssetMode).toBe("full");
  });

  it("preserves a persisted consolidate choice", () => {
    const s = coerceSettings({ consolidateChapterMode: "move", consolidateAssetMode: "cover" });
    expect(s.consolidateChapterMode).toBe("move");
    expect(s.consolidateAssetMode).toBe("cover");
  });

  it("fills defaults when absent from persisted data", () => {
    const s = coerceSettings({ outputDestination: "share" });
    expect(s.consolidateChapterMode).toBe("copy");
    expect(s.consolidateAssetMode).toBe("full");
  });
});
