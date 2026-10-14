// src/obsidian/output.ts
import { App, Notice } from "obsidian";
import { OutputDestination, resolveOutputPath, sanitizeBase } from "../core/output-path";
import { getLang, t } from "../vendor/kit/i18n";
import { SHARE_EXPORT_STRINGS_DE, SHARE_EXPORT_STRINGS_EN, shareExport } from "../vendor/kit-obsidian/share-export";
import { vaultDirname } from "../vendor/kit/vault-path";

const MIME = "application/epub+zip";

export async function writeEpub(
  app: App,
  bytes: Uint8Array,
  dest: OutputDestination,
  ctx: { baseName: string; noteDir: string; customFolder: string; attachmentPath: string }
): Promise<{ savedPath: string | null }> {
  const adapter = app.vault.adapter;
  const safe = `${sanitizeBase(ctx.baseName)}.epub`;

  if (dest === "share") {
    // Writing, clearing the hidden folder (own old exports silently, anything else only after a question) and the
    // hand-over (share sheet, else the default app) are the kit's `shareExport`; the notice texts stay ours.
    const base = getLang() === "de" ? SHARE_EXPORT_STRINGS_DE : SHARE_EXPORT_STRINGS_EN;
    await shareExport(app, bytes, { dir: ".epub-export", fileName: safe, mime: MIME, strings: { ...base, done: t("notice.shared") } });
    return { savedPath: null };
  }

  const path = resolveOutputPath(dest, {
    noteDir: ctx.noteDir,
    baseName: ctx.baseName,
    customFolder: ctx.customFolder,
    attachmentPath: ctx.attachmentPath,
  });
  // Only "share" yields null; the guard keeps TypeScript happy and is defensive.
  if (path === null) return { savedPath: null };
  const dir = vaultDirname(path);
  if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
  await adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
  new Notice(t("notice.saved", path));
  return { savedPath: path };
}
