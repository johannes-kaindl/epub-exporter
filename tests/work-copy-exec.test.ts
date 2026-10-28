import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "./mocks/obsidian";
import { collectVaultEntries, executeWorkCopy, WorkCopyPort } from "../src/obsidian/work-copy";
import { planWorkCopy } from "../src/core/work-copy";

class FakeWorkCopyPort implements WorkCopyPort {
  existing: Set<string>;
  calls: string[] = [];
  constructor(existing: string[] = []) { this.existing = new Set(existing); }
  async exists(path: string) { return this.existing.has(path); }
  async createFolder(path: string) { this.calls.push(`folder ${path}`); this.existing.add(path); }
  async copyFile(from: string, to: string) { this.calls.push(`copy ${from} -> ${to}`); this.existing.add(to); }
}

const plan = planWorkCopy(
  [
    { path: "P/docs", isFolder: true },
    { path: "P/docs/a.md", isFolder: false },
    { path: "P/docs/img", isFolder: true },
    { path: "P/docs/img/x.png", isFolder: false },
  ],
  "P/docs",
  "Arbeit/P/docs",
);

describe("executeWorkCopy", () => {
  it("creates the folders before the files and copies every file", async () => {
    const port = new FakeWorkCopyPort();
    const res = await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(res).toEqual({ created: true });
    expect(port.calls).toEqual([
      "folder Arbeit", "folder Arbeit/P", "folder Arbeit/P/docs", "folder Arbeit/P/docs/img",
      "copy P/docs/a.md -> Arbeit/P/docs/a.md", "copy P/docs/img/x.png -> Arbeit/P/docs/img/x.png",
    ]);
  });

  it("skips folders that exist already, the working directory for one", async () => {
    const port = new FakeWorkCopyPort(["Arbeit", "Arbeit/P"]);
    await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(port.calls.filter((c) => c.startsWith("folder"))).toEqual(["folder Arbeit/P/docs", "folder Arbeit/P/docs/img"]);
  });

  it("never overwrites: an existing copy stays untouched and nothing is called", async () => {
    const port = new FakeWorkCopyPort(["Arbeit/P/docs"]);
    const res = await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(res).toEqual({ created: false });
    expect(port.calls).toEqual([]);
  });
});

describe("collectVaultEntries", () => {
  const folder = (path: string): TFolder => Object.assign(new TFolder(), { path });
  const file = (path: string): TFile => Object.assign(new TFile(), { path });

  it("turns what the vault has loaded into the entries planWorkCopy reads: folders flagged, files not", () => {
    const app = {
      vault: { getAllLoadedFiles: () => [folder("/"), folder("P"), folder("P/docs"), file("P/docs/a.md"), file("P/docs/img.png")] },
    } as unknown as App;
    expect(collectVaultEntries(app)).toEqual([
      { path: "/", isFolder: true },
      { path: "P", isFolder: true },
      { path: "P/docs", isFolder: true },
      { path: "P/docs/a.md", isFolder: false },
      { path: "P/docs/img.png", isFolder: false },
    ]);
  });

  it("plans the same copy as the hand-written entries do (the vault root and entries elsewhere are ignored)", () => {
    const app = {
      vault: {
        getAllLoadedFiles: () => [folder("/"), folder("P"), folder("P/docs"), file("P/docs/a.md"), folder("P/docs/img"), file("P/docs/img/x.png"), file("P/other.md")],
      },
    } as unknown as App;
    expect(planWorkCopy(collectVaultEntries(app), "P/docs", "Arbeit/P/docs")).toEqual(plan);
  });
});
