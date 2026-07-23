// Node-testable slice of EpubSettingTab: the declarative getSettingDefinitions()
// contract plus the getControlValue/setControlValue value logic. None of these
// touch the DOM, so they run under the vitest "obsidian" alias without a real
// SettingTab render. display() (the <1.13 fallback) is out of scope here.
import { describe, expect, test } from "vitest";
import type { App } from "obsidian";
import { EpubSettingTab } from "../../src/obsidian/settings-tab";
import { DEFAULT_SETTINGS, EpubExporterSettings } from "../../src/obsidian/settings";

interface SettingDef {
  control?: { key: string; type: string; options?: Record<string, string> };
  desc?: string;
  visible?: () => boolean;
}

function makeTab(overrides: Partial<EpubExporterSettings> = {}) {
  const settings: EpubExporterSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const state = { saves: 0 };
  const plugin = { settings, saveSettings: async () => { state.saves += 1; } };
  const tab = new EpubSettingTab({} as unknown as App, plugin);
  return { tab, settings, state };
}

function defs(tab: EpubSettingTab): SettingDef[] {
  return tab.getSettingDefinitions() as unknown as SettingDef[];
}
function byKey(tab: EpubSettingTab, key: string): SettingDef {
  const found = defs(tab).find((d) => d.control?.key === key);
  if (!found) throw new Error(`no setting for key ${key}`);
  return found;
}

describe("EpubSettingTab.getSettingDefinitions", () => {
  test("maps each setting to a control in spec order", () => {
    const keys = defs(makeTab().tab).map((d) => d.control?.key);
    expect(keys).toEqual([
      "outputDestination",
      "customFolder",
      "defaultLanguage",
      "openSidebarOnStartup",
    ]);
  });

  test("uses the right control type per setting", () => {
    const tab = makeTab().tab;
    expect(byKey(tab, "outputDestination").control?.type).toBe("dropdown");
    expect(byKey(tab, "customFolder").control?.type).toBe("text");
    expect(byKey(tab, "defaultLanguage").control?.type).toBe("dropdown");
    expect(byKey(tab, "openSidebarOnStartup").control?.type).toBe("toggle");
  });

  test("offers all four output destinations", () => {
    const options = byKey(makeTab().tab, "outputDestination").control?.options ?? {};
    expect(Object.keys(options)).toEqual([
      "besideNote",
      "attachmentFolder",
      "customFolder",
      "share",
    ]);
  });

  test("keeps every definition static — no visible predicate (avoids 1.13-only refresh)", () => {
    // With minAppVersion 1.8.7 we cannot call the 1.13 refreshDomState/update
    // APIs, so declarative rows must not depend on runtime-evaluated visibility.
    for (const d of defs(makeTab({ outputDestination: "besideNote" }).tab)) {
      expect(d.visible).toBeUndefined();
    }
  });

  test("gives customFolder a desc hint since it is always shown", () => {
    const desc = byKey(makeTab().tab, "customFolder").desc;
    expect(typeof desc).toBe("string");
    expect((desc as string).length).toBeGreaterThan(0);
  });
});

describe("EpubSettingTab.getControlValue", () => {
  test("returns the stored value for a plain key", () => {
    expect(makeTab({ outputDestination: "share" }).tab.getControlValue("outputDestination")).toBe("share");
  });

  test("preserves a 'de' language", () => {
    expect(makeTab({ defaultLanguage: "de" }).tab.getControlValue("defaultLanguage")).toBe("de");
  });

  test("coerces an unknown stored language to 'en'", () => {
    expect(makeTab({ defaultLanguage: "fr" }).tab.getControlValue("defaultLanguage")).toBe("en");
  });
});

describe("EpubSettingTab.setControlValue", () => {
  test("trims and persists customFolder", async () => {
    const { tab, settings, state } = makeTab();
    await tab.setControlValue("customFolder", "  Books/EPUB  ");
    expect(settings.customFolder).toBe("Books/EPUB");
    expect(state.saves).toBe(1);
  });

  test("persists a plain key verbatim", async () => {
    const { tab, settings } = makeTab();
    await tab.setControlValue("openSidebarOnStartup", true);
    expect(settings.openSidebarOnStartup).toBe(true);
  });

  test("never calls the 1.13-only refreshDomState, even on the output mode", async () => {
    // Rows are static (no visible predicate), so nothing needs the 1.13 refresh
    // API — keeping setControlValue safe to define under minAppVersion 1.8.7.
    const { tab } = makeTab();
    await tab.setControlValue("outputDestination", "customFolder");
    await tab.setControlValue("openSidebarOnStartup", true);
    expect((tab as unknown as { refreshDomStateCalls: number }).refreshDomStateCalls).toBe(0);
  });
});
