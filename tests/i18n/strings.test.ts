import { describe, it, expect } from "vitest";
import { EN, DE } from "../../src/i18n/strings";

describe("i18n strings", () => {
  it("EN and DE have identical key sets", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it("the empty-state hint carries the placeholder for the command name in both languages", () => {
    expect(EN["view.emptyHint"]).toContain("{0}");
    expect(DE["view.emptyHint"]).toContain("{0}");
  });

  it("no value is an empty string", () => {
    for (const [k, v] of Object.entries(EN)) expect(v, `EN ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(DE)) expect(v, `DE ${k}`).not.toBe("");
  });
});
