// src/obsidian/work-copy.ts
import { App, TFile, TFolder } from "obsidian";
import { CopyPlan } from "../core/work-copy";

export interface WorkCopyPort {
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Renames a folder (a pure rename: links inside the copied files stay as they are). */
  renameFolder(from: string, to: string): Promise<void>;
  /** Moves a folder to the trash the user has set (the vault's trash way, never a delete). */
  trash(path: string): Promise<void>;
}

/** Suffix of the helper folder next to the target; the copy is built there and renamed to the target at the end. */
export const WORK_COPY_TEMP_SUFFIX = ".epub-exporter-tmp";

export function createWorkCopyPort(app: App): WorkCopyPort {
  return {
    async exists(path) {
      return app.vault.getAbstractFileByPath(path) !== null;
    },
    async createFolder(path) {
      await app.vault.createFolder(path);
    },
    async copyFile(from, to) {
      const file = app.vault.getAbstractFileByPath(from);
      if (!(file instanceof TFile)) throw new Error(`Cannot copy, not a file: ${from}`);
      await app.vault.copy(file, to);
    },
    async renameFolder(from, to) {
      const folder = app.vault.getAbstractFileByPath(from);
      if (!(folder instanceof TFolder)) throw new Error(`Cannot rename, not a folder: ${from}`);
      await app.vault.rename(folder, to);
    },
    async trash(path) {
      const entry = app.vault.getAbstractFileByPath(path);
      if (entry) await app.fileManager.trashFile(entry);
    },
  };
}

/** Every entry the vault has loaded, folders flagged: the input of `planWorkCopy`, which picks the ones below the folder to copy. */
export function collectVaultEntries(app: App): Array<{ path: string; isFolder: boolean }> {
  return app.vault.getAllLoadedFiles().map((entry) => ({ path: entry.path, isFolder: entry instanceof TFolder }));
}

/** Carries out the plan. A copy that exists already (`to`) is never touched: its owner has renamed things there.
 *  The copy is built in a helper folder next to the target and renamed to the target at the end, so an abort (disk full, sync
 *  conflict) never leaves a half copy under the target name, where the next try would take it for a finished one. A helper folder
 *  an earlier abort left behind is moved to the trash first. */
export async function executeWorkCopy(port: WorkCopyPort, plan: CopyPlan, to: string): Promise<{ created: boolean }> {
  if (await port.exists(to)) return { created: false };
  const temp = `${to}${WORK_COPY_TEMP_SUFFIX}`;
  if (await port.exists(temp)) await port.trash(temp);
  const inTemp = (path: string): string => (path === to ? temp : path.startsWith(`${to}/`) ? `${temp}${path.slice(to.length)}` : path);
  for (const folder of plan.folders) {
    const at = inTemp(folder);
    if (!(await port.exists(at))) await port.createFolder(at);
  }
  for (const file of plan.files) await port.copyFile(file.from, inTemp(file.to));
  await port.renameFolder(temp, to);
  return { created: true };
}
