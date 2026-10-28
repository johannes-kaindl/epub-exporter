import { describe, it, expect } from "vitest";
import { planWorkCopy, workCopyPath } from "../../src/core/work-copy";

describe("workCopyPath", () => {
  it("mirrors the vault path of the original under the working directory", () => {
    expect(workCopyPath("Arbeit", "Projekte/nvim/docs")).toEqual({ ok: true, path: "Arbeit/Projekte/nvim/docs" });
  });

  it("tolerates slash noise in both paths", () => {
    expect(workCopyPath("/Arbeit/", "Projekte//nvim/docs/")).toEqual({ ok: true, path: "Arbeit/Projekte/nvim/docs" });
  });

  it("refuses an empty working directory", () => {
    expect(workCopyPath("", "Projekte/docs")).toEqual({ ok: false, reason: "no-workdir" });
    expect(workCopyPath("/", "Projekte/docs")).toEqual({ ok: false, reason: "no-workdir" });
  });

  it("refuses an original that is the working directory or lies inside it", () => {
    expect(workCopyPath("Arbeit", "Arbeit")).toEqual({ ok: false, reason: "inside-workdir" });
    expect(workCopyPath("Arbeit", "Arbeit/Projekte/docs")).toEqual({ ok: false, reason: "inside-workdir" });
    expect(workCopyPath("arbeit", "Arbeit/docs")).toEqual({ ok: false, reason: "inside-workdir" });
  });

  it("refuses an original that contains the working directory, and the vault root", () => {
    expect(workCopyPath("Projekte/Arbeit", "Projekte")).toEqual({ ok: false, reason: "contains-workdir" });
    expect(workCopyPath("Arbeit", "")).toEqual({ ok: false, reason: "contains-workdir" });
    expect(workCopyPath("Arbeit", "/")).toEqual({ ok: false, reason: "contains-workdir" });
  });

  it("reads names as the file system does: case, trailing dot and blank do not make a different folder", () => {
    expect(workCopyPath("Arbeit.", "Arbeit/docs")).toEqual({ ok: false, reason: "inside-workdir" });
    expect(workCopyPath("Arbeit ", "Arbeit/docs")).toEqual({ ok: false, reason: "inside-workdir" });
    expect(workCopyPath("Arbeit", "ARBEIT./docs")).toEqual({ ok: false, reason: "inside-workdir" });
    expect(workCopyPath("Projekte/Arbeit", "projekte.")).toEqual({ ok: false, reason: "contains-workdir" });
    expect(workCopyPath("Projekte/Arbeit.", "Projekte ")).toEqual({ ok: false, reason: "contains-workdir" });
  });

  it("does not mistake a name that only starts the same for a parent", () => {
    expect(workCopyPath("Arbeit", "Arbeitsdocs/x")).toEqual({ ok: true, path: "Arbeit/Arbeitsdocs/x" });
    expect(workCopyPath("Projekte/Arbeit2", "Projekte/Arbeit")).toEqual({ ok: true, path: "Projekte/Arbeit2/Projekte/Arbeit" });
  });
});

describe("planWorkCopy", () => {
  const entries = [
    { path: "Projekte/nvim/docs", isFolder: true },
    { path: "Projekte/nvim/docs/README.md", isFolder: false },
    { path: "Projekte/nvim/docs/img", isFolder: true },
    { path: "Projekte/nvim/docs/img/a.png", isFolder: false },
    { path: "Projekte/nvim/docs/tutorials", isFolder: true },
    { path: "Projekte/nvim/docs/tutorials/lektion-01.md", isFolder: false },
    { path: "Projekte/nvim/src/main.lua", isFolder: false },
    { path: "Projekte/nvim/docs2/x.md", isFolder: false },
  ];

  it("mirrors folders and files, images and attachments included, and leaves everything outside alone", () => {
    const plan = planWorkCopy(entries, "Projekte/nvim/docs", "Arbeit/Projekte/nvim/docs");
    expect(plan.files).toEqual([
      { from: "Projekte/nvim/docs/README.md", to: "Arbeit/Projekte/nvim/docs/README.md" },
      { from: "Projekte/nvim/docs/img/a.png", to: "Arbeit/Projekte/nvim/docs/img/a.png" },
      { from: "Projekte/nvim/docs/tutorials/lektion-01.md", to: "Arbeit/Projekte/nvim/docs/tutorials/lektion-01.md" },
    ]);
  });

  it("lists the target and all its ancestors first, shallow to deep", () => {
    const plan = planWorkCopy(entries, "Projekte/nvim/docs", "Arbeit/Projekte/nvim/docs");
    expect(plan.folders.slice(0, 4)).toEqual(["Arbeit", "Arbeit/Projekte", "Arbeit/Projekte/nvim", "Arbeit/Projekte/nvim/docs"]);
    expect(plan.folders.slice(4).sort()).toEqual(["Arbeit/Projekte/nvim/docs/img", "Arbeit/Projekte/nvim/docs/tutorials"]);
    expect(new Set(plan.folders).size).toBe(plan.folders.length);
  });

  it("orders a deep tree by depth, never a child before its parent", () => {
    const deep = [
      { path: "d/a/b/c/f.md", isFolder: false },
      { path: "d/a/b/c", isFolder: true },
      { path: "d/a", isFolder: true },
      { path: "d/a/b", isFolder: true },
    ];
    const { folders } = planWorkCopy(deep, "d", "W/d");
    for (const folder of folders) {
      const parent = folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
      if (parent) expect(folders.indexOf(parent)).toBeGreaterThanOrEqual(0);
      if (parent) expect(folders.indexOf(parent)).toBeLessThan(folders.indexOf(folder));
    }
    expect(folders).toEqual(["W", "W/d", "W/d/a", "W/d/a/b", "W/d/a/b/c"]);
  });

  it("copies an empty folder tree as folders only", () => {
    const plan = planWorkCopy([{ path: "d/leer", isFolder: true }], "d", "W/d");
    expect(plan.files).toEqual([]);
    expect(plan.folders).toEqual(["W", "W/d", "W/d/leer"]);
  });
});
