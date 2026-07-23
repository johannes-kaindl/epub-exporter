// src/obsidian/import.ts
import { App, TFile, TFolder, stringifyYaml } from "obsidian";
import { ImportPlan } from "../core/import-plan";

export interface ImportPort {
  exists(path: string): Promise<boolean>;
  createNote(path: string, content: string): Promise<void>;
}

export function createImportPort(app: App): ImportPort {
  return {
    async exists(path) {
      return app.vault.getAbstractFileByPath(path) !== null;
    },
    async createNote(path, content) {
      await app.vault.create(path, content);
    },
  };
}

// List the .md basenames directly inside a folder (for buildImportPlan).
export function folderMdBasenames(app: App, folderPath: string): string[] {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
    .map((f) => f.basename);
}

export interface ImportResult { created: boolean; notePath: string; }

export async function executeImport(
  port: ImportPort,
  folderPath: string,
  plan: ImportPlan
): Promise<ImportResult> {
  const notePath = `${folderPath}/${plan.bookNoteName}`;
  if (await port.exists(notePath)) return { created: false, notePath };
  const yaml = stringifyYaml(plan.frontmatter).trimEnd();
  const content = `---\n${yaml}\n---\n\n${plan.body}\n`;
  await port.createNote(notePath, content);
  return { created: true, notePath };
}
