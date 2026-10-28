import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "./mocks/obsidian";
import { collectVaultEntries, executeWorkCopy, WORK_COPY_TEMP_SUFFIX, WorkCopyPort } from "../src/obsidian/work-copy";
import { planWorkCopy } from "../src/core/work-copy";

class FakeWorkCopyPort implements WorkCopyPort {
  existing: Set<string>;
  calls: string[] = [];
  /** Throws on the n-th copy (1-based) once, like a full disk would. */
  failOnCopy: number | null = null;
  private copies = 0;
  constructor(existing: string[] = []) { this.existing = new Set(existing); }
  async exists(path: string) { return this.existing.has(path); }
  async createFolder(path: string) { this.calls.push(`folder ${path}`); this.existing.add(path); }
  async copyFile(from: string, to: string) {
    this.copies += 1;
    if (this.failOnCopy === this.copies) { this.failOnCopy = null; throw new Error("disk full"); }
    this.calls.push(`copy ${from} -> ${to}`);
    this.existing.add(to);
  }
  private below(path: string) { return [...this.existing].filter((p) => p === path || p.startsWith(`${path}/`)); }
  async renameFolder(from: string, to: string) {
    this.calls.push(`rename ${from} -> ${to}`);
    for (const p of this.below(from)) { this.existing.delete(p); this.existing.add(`${to}${p.slice(from.length)}`); }
  }
  async trash(path: string) {
    this.calls.push(`trash ${path}`);
    for (const p of this.below(path)) this.existing.delete(p);
  }
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
const TEMP = `Arbeit/P/docs${WORK_COPY_TEMP_SUFFIX}`;

describe("executeWorkCopy", () => {
  it("builds the copy in a helper folder next to the target and renames it at the end", async () => {
    const port = new FakeWorkCopyPort();
    const res = await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(res).toEqual({ created: true });
    expect(port.calls).toEqual([
      "folder Arbeit", "folder Arbeit/P", `folder ${TEMP}`, `folder ${TEMP}/img`,
      `copy P/docs/a.md -> ${TEMP}/a.md`, `copy P/docs/img/x.png -> ${TEMP}/img/x.png`,
      `rename ${TEMP} -> Arbeit/P/docs`,
    ]);
    expect(port.existing.has("Arbeit/P/docs/img/x.png")).toBe(true);
    expect(port.existing.has(TEMP)).toBe(false);
  });

  it("skips ancestors that exist already, the working directory for one", async () => {
    const port = new FakeWorkCopyPort(["Arbeit", "Arbeit/P"]);
    await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(port.calls.filter((c) => c.startsWith("folder"))).toEqual([`folder ${TEMP}`, `folder ${TEMP}/img`]);
  });

  it("never overwrites: an existing copy stays untouched and nothing is called", async () => {
    const port = new FakeWorkCopyPort(["Arbeit/P/docs"]);
    const res = await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(res).toEqual({ created: false });
    expect(port.calls).toEqual([]);
  });

  it("an abort in the middle leaves no target; the second try trashes the helper folder and runs through", async () => {
    const port = new FakeWorkCopyPort();
    port.failOnCopy = 2; // the first file is copied, the second one throws
    await expect(executeWorkCopy(port, plan, "Arbeit/P/docs")).rejects.toThrow("disk full");
    expect(port.existing.has("Arbeit/P/docs")).toBe(false); // the click that follows does not find a "finished" copy
    expect(port.existing.has(`${TEMP}/a.md`)).toBe(true); // what the abort left, in the helper folder only

    port.calls.length = 0;
    const res = await executeWorkCopy(port, plan, "Arbeit/P/docs");
    expect(res).toEqual({ created: true });
    expect(port.calls[0]).toBe(`trash ${TEMP}`);
    expect(port.existing.has("Arbeit/P/docs/a.md")).toBe(true);
    expect(port.existing.has("Arbeit/P/docs/img/x.png")).toBe(true);
    expect([...port.existing].some((p) => p.includes(WORK_COPY_TEMP_SUFFIX))).toBe(false);
  });

  it("a rename that fails also leaves no target", async () => {
    const port = new FakeWorkCopyPort();
    port.renameFolder = async () => { throw new Error("sync conflict"); };
    await expect(executeWorkCopy(port, plan, "Arbeit/P/docs")).rejects.toThrow("sync conflict");
    expect(port.existing.has("Arbeit/P/docs")).toBe(false);
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
