import { sanitizeBase as sanitizeBaseKit } from "../vendor/kit/filename-template";
import { joinVaultPath } from "../vendor/kit/vault-path";

// The four output destinations. Declared here (not imported from src/obsidian/settings.ts)
// so this module stays free of any obsidian-namespaced import and remains node-testable.
export type OutputDestination = "besideNote" | "attachmentFolder" | "customFolder" | "share";

/** Dateiname ohne Pfad- und Sonderzeichen; leer wird „Untitled“. Die Regel selbst liegt im Kit
 *  (`sanitizeBase`, code-kit `filename-template`), hier steht nur der Fallback. */
export function sanitizeBase(name: string): string {
  return sanitizeBaseKit(name, "Untitled");
}

export function resolveOutputPath(
  dest: OutputDestination,
  opts: { noteDir: string; baseName: string; customFolder: string; attachmentPath: string }
): string | null {
  if (dest === "share") return null;
  const file = `${sanitizeBase(opts.baseName)}.epub`;
  if (dest === "besideNote") return joinVaultPath(opts.noteDir, file);
  if (dest === "customFolder") return joinVaultPath(opts.customFolder, file);
  // attachmentFolder: attachmentPath is a resolved vault path from getAvailablePathForAttachment.
  return opts.attachmentPath;
}
