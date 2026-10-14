import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

// The confirmation modal needs a real Obsidian; the answer is what the test controls.
const confirmAnswer = vi.hoisted(() => ({ value: false, asked: 0 }));
vi.mock("../../src/vendor/kit-obsidian/confirm", () => ({
  confirmAction: async () => {
    confirmAnswer.asked++;
    return confirmAnswer.value;
  },
}));

import { writeEpub } from "../../src/obsidian/output";

const BYTES = new Uint8Array([80, 75, 3, 4]);

function makeApp(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const opened: string[] = [];
  const adapter = {
    exists: async (p: string) => p === ".epub-export" || files.has(p),
    mkdir: async () => {},
    list: async (dir: string) => ({ files: [...files.keys()].filter((k) => k.startsWith(`${dir}/`)), folders: [] as string[] }),
    remove: async (p: string) => { files.delete(p); },
    rmdir: async () => {},
    writeBinary: async (p: string) => { files.set(p, "bytes"); },
  };
  const app = {
    vault: { adapter, configDir: ".obsidian" },
    openWithDefaultApp: async (p: string) => { opened.push(p); },
  } as unknown as App;
  return { app, files, opened };
}

const ctx = { baseName: "My Book", noteDir: "", customFolder: "", attachmentPath: "" };

describe("writeEpub — share destination", () => {
  beforeEach(() => {
    confirmAnswer.value = false;
    confirmAnswer.asked = 0;
  });

  it("writes into the hidden export folder and hands the file over", async () => {
    const { app, files, opened } = makeApp({});
    const res = await writeEpub(app, BYTES, "share", ctx);
    expect(res.savedPath).toBeNull();
    expect(files.has(".epub-export/My Book.epub")).toBe(true);
    expect(opened).toEqual([".epub-export/My Book.epub"]);
    expect(confirmAnswer.asked).toBe(0);
  });

  it("clears its own old exports without asking", async () => {
    const { app, files } = makeApp({ ".epub-export/Old.epub": "x", ".epub-export/.DS_Store": "x" });
    await writeEpub(app, BYTES, "share", ctx);
    expect([...files.keys()]).toEqual([".epub-export/My Book.epub"]);
    expect(confirmAnswer.asked).toBe(0);
  });

  it("keeps foreign files when the user declines the question", async () => {
    const { app, files } = makeApp({ ".epub-export/notes.txt": "mine", ".epub-export/Old.epub": "x" });
    confirmAnswer.value = false;
    await writeEpub(app, BYTES, "share", ctx);
    expect(confirmAnswer.asked).toBe(1);
    expect(files.has(".epub-export/notes.txt")).toBe(true);
    expect(files.has(".epub-export/Old.epub")).toBe(false);
    expect(files.has(".epub-export/My Book.epub")).toBe(true);
  });

  it("deletes foreign files only after a yes", async () => {
    const { app, files } = makeApp({ ".epub-export/notes.txt": "mine" });
    confirmAnswer.value = true;
    await writeEpub(app, BYTES, "share", ctx);
    expect(files.has(".epub-export/notes.txt")).toBe(false);
  });
});
