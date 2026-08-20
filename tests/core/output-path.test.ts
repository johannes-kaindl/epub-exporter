import { describe, it, expect } from "vitest";
import { sanitizeBase, resolveOutputPath } from "../../src/core/output-path";

describe("sanitizeBase", () => {
  it("strips path-hostile characters and falls back when empty", () => {
    expect(sanitizeBase('a/b:c*?"<>|d')).toBe("abcd");
    expect(sanitizeBase("   ")).toBe("Untitled");
  });
});

describe("resolveOutputPath", () => {
  const opts = { noteDir: "Books", baseName: "My Book", customFolder: "Export", attachmentPath: "att/My Book.epub" };
  it("beside the note", () => {
    expect(resolveOutputPath("besideNote", opts)).toBe("Books/My Book.epub");
  });
  it("beside the note at vault root (no dir)", () => {
    expect(resolveOutputPath("besideNote", { ...opts, noteDir: "" })).toBe("My Book.epub");
  });
  it("custom folder", () => {
    expect(resolveOutputPath("customFolder", opts)).toBe("Export/My Book.epub");
  });
  // Neu seit dem Umstieg auf obsidian-kit `joinVaultPath` (Vendoring 0.27.0): customFolder ist ein
  // freies Textfeld und kommt roh hier an — Backslashes und Mehrfach-Slashes werden jetzt normalisiert.
  it("normalizes backslashes in a hand-typed custom folder", () => {
    expect(resolveOutputPath("customFolder", { ...opts, customFolder: "Export\\Bücher" })).toBe("Export/Bücher/My Book.epub");
  });
  it("collapses double slashes in a hand-typed custom folder", () => {
    expect(resolveOutputPath("customFolder", { ...opts, customFolder: "Export//Bücher" })).toBe("Export/Bücher/My Book.epub");
  });
  it("attachment folder passes the resolved attachment path through", () => {
    expect(resolveOutputPath("attachmentFolder", opts)).toBe("att/My Book.epub");
  });
  it("share has no vault target", () => {
    expect(resolveOutputPath("share", opts)).toBeNull();
  });
});
