// The four output destinations. Declared here (not imported from src/obsidian/settings.ts)
// so this module stays free of any obsidian-namespaced import and remains node-testable.
export type OutputDestination = "besideNote" | "attachmentFolder" | "customFolder" | "share";

export function sanitizeBase(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || "Untitled";
}

// Join two vault-relative fragments without leading/trailing slash noise.
function joinPath(dir: string, file: string): string {
  const d = (dir || "").replace(/^\/+|\/+$/g, "");
  return d ? `${d}/${file}` : file;
}

export function resolveOutputPath(
  dest: OutputDestination,
  opts: { noteDir: string; baseName: string; customFolder: string; attachmentPath: string }
): string | null {
  if (dest === "share") return null;
  const file = `${sanitizeBase(opts.baseName)}.epub`;
  if (dest === "besideNote") return joinPath(opts.noteDir, file);
  if (dest === "customFolder") return joinPath(opts.customFolder, file);
  // attachmentFolder: attachmentPath is a resolved vault path from getAvailablePathForAttachment.
  return opts.attachmentPath;
}
