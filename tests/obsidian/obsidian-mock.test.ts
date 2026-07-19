import { describe, it, expect } from "vitest";
import { makeFakeEl, setIcon, MarkdownView, TFile } from "../mocks/obsidian";

describe("obsidian mock", () => {
  it("builds nested elements with cls/text/attr and finds them", () => {
    const root = makeFakeEl();
    const box = root.createDiv({ cls: "outer" });
    box.createSpan({ cls: "inner", text: "hi", attr: { "data-x": "1" } });
    expect(root.find("inner")?.text).toBe("hi");
    expect(root.find("inner")?.getAttribute("data-x")).toBe("1");
    expect(root.findAll("outer")).toHaveLength(1);
  });

  it("toggleClass respects the explicit on flag", () => {
    const el = makeFakeEl();
    el.toggleClass("is-hidden", true);
    expect(el.hasClass("is-hidden")).toBe(true);
    el.toggleClass("is-hidden", false);
    expect(el.hasClass("is-hidden")).toBe(false);
  });

  it("fires click listeners and records icons", () => {
    const el = makeFakeEl();
    let clicked = 0;
    el.addEventListener("click", () => clicked++);
    el.click();
    expect(clicked).toBe(1);
    setIcon(el, "book");
    expect(el.getAttribute("data-icon")).toBe("book");
  });

  it("MarkdownView instanceof works and carries a file", () => {
    const v = new MarkdownView();
    v.file = new TFile();
    expect(v instanceof MarkdownView).toBe(true);
    expect(v.file).not.toBeNull();
  });
});
