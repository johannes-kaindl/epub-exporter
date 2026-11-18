import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findVendoredCss, missingKitCss } from "../vendor/kit/kit-css";

// Kit-Vertrag: die *_CSS-Konstanten gevendorter Bausteine stehen wortgleich in der styles.css.
describe("Kit-CSS in styles.css", () => {
  const css = readFileSync("styles.css", "utf8");
  it("der Wächter findet gevendorte Konstanten (Gegenprobe: er kann finden)", () => {
    expect(findVendoredCss("src/vendor").map((h) => h.name)).toContain("STATUS_INDICATOR_CSS");
  });
  it("keine Konstante fehlt", () => {
    expect(missingKitCss("src/vendor", css)).toEqual([]);
  });
});
