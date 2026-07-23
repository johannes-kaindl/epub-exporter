// tests/import-exec.test.ts
import { describe, it, expect } from "vitest";
import { executeImport, ImportPort } from "../src/obsidian/import";
import { buildImportPlan } from "../src/core/import-plan";

class FakeImportPort implements ImportPort {
  created = new Map<string, string>();
  existing: Set<string>;
  constructor(existing: string[] = []) { this.existing = new Set(existing); }
  async exists(path: string) { return this.existing.has(path); }
  async createNote(path: string, content: string) { this.created.set(path, content); }
}

describe("executeImport", () => {
  it("creates the folder note with frontmatter + spine", async () => {
    const port = new FakeImportPort();
    const plan = buildImportPlan("My Book", ["01 Intro", "02 Body"], "en");
    const res = await executeImport(port, "folder/My Book", plan);
    expect(res.created).toBe(true);
    const content = port.created.get("folder/My Book/My Book.md")!;
    expect(content).toContain("epub: true");
    expect(content).toContain("![[01 Intro]]");
    expect(content).toContain("![[02 Body]]");
  });

  it("refuses to overwrite an existing folder note", async () => {
    const port = new FakeImportPort(["folder/My Book/My Book.md"]);
    const plan = buildImportPlan("My Book", ["a"], "en");
    const res = await executeImport(port, "folder/My Book", plan);
    expect(res.created).toBe(false);
    expect(port.created.size).toBe(0);
  });
});
