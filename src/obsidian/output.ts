// src/obsidian/output.ts
import { App, Notice } from "obsidian";
import { OutputDestination, resolveOutputPath, sanitizeBase } from "../core/output-path";
import { t } from "../vendor/kit/i18n";

// Runtime-only API surfaces not covered by the public Obsidian typings.
interface ShareCapableNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
}
interface AppWithDefaultApp {
  openWithDefaultApp?: (path: string) => Promise<void>;
}

const MIME = "application/epub+zip";

export async function writeEpub(
  app: App,
  bytes: Uint8Array,
  dest: OutputDestination,
  ctx: { baseName: string; noteDir: string; customFolder: string; attachmentPath: string }
): Promise<{ savedPath: string | null }> {
  const adapter = app.vault.adapter;
  const appExt = app as unknown as AppWithDefaultApp;
  const safe = `${sanitizeBase(ctx.baseName)}.epub`;

  if (dest === "share") {
    const dir = ".epub-export";
    const path = `${dir}/${safe}`;
    if (await adapter.exists(dir)) {
      const l = await adapter.list(dir);
      for (const f of l.files) await adapter.remove(f);
    } else {
      await adapter.mkdir(dir);
    }
    await adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
    const fileObj = typeof File === "function" ? new File([bytes as BlobPart], safe, { type: MIME }) : null;
    const nav = navigator as ShareCapableNavigator;
    if (fileObj && nav.canShare?.({ files: [fileObj] }) && nav.share) {
      try {
        await nav.share({ files: [fileObj] });
        new Notice(t("notice.shared"));
        return { savedPath: null };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return { savedPath: null };
      }
    }
    if (typeof appExt.openWithDefaultApp === "function") await appExt.openWithDefaultApp(path);
    new Notice(t("notice.shared"));
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
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
  await adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
  new Notice(t("notice.saved", path));
  return { savedPath: path };
}
