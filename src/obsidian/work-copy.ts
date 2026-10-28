// src/obsidian/work-copy.ts
import { App, TFile } from "obsidian";
import { CopyPlan } from "../core/work-copy";

export interface WorkCopyPort {
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
}

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
  };
}

/** Carries out the plan. A copy that exists already (`to`) is never touched: its owner has renamed things there. */
export async function executeWorkCopy(port: WorkCopyPort, plan: CopyPlan, to: string): Promise<{ created: boolean }> {
  if (await port.exists(to)) return { created: false };
  for (const folder of plan.folders) {
    if (!(await port.exists(folder))) await port.createFolder(folder);
  }
  for (const file of plan.files) await port.copyFile(file.from, file.to);
  return { created: true };
}
