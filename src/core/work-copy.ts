import { isInFolder } from "../vendor/kit/folder-scope";
import { joinVaultPath, normalizeVaultDir } from "../vendor/kit/vault-path";

export interface CopyPlan {
  /** Folders to create, shallow to deep: the target, all its ancestors and every sub-folder. */
  folders: string[];
  files: { from: string; to: string }[];
}

// A boundary that guards a write (no copy into itself) reads names as the strictest file system does: case, a trailing dot or blank.
const GUARD = { self: true, reading: "filesystem" } as const;

/** Where the working copy of `originalPath` lives: the vault path of the original, mirrored under `workDir`, so equally named
 *  folders (`docs` from many repos) do not collide and the target follows from the original alone. Refuses when there is no
 *  working directory, when the original is the working directory or lies in it, and when the original holds the working
 *  directory (or is the vault root): a folder cannot be copied into itself. Names compare as the file system reads them
 *  (`isInFolder`, reading `filesystem`): without case, and `Arbeit.` is `Arbeit`. */
export function workCopyPath(workDir: string, originalPath: string): { ok: true; path: string } | { ok: false; reason: "no-workdir" | "inside-workdir" | "contains-workdir" } {
  const work = normalizeVaultDir(workDir);
  const original = normalizeVaultDir(originalPath);
  if (work === "") return { ok: false, reason: "no-workdir" };
  if (original === "") return { ok: false, reason: "contains-workdir" };
  if (isInFolder(original, work, GUARD)) return { ok: false, reason: "inside-workdir" };
  if (isInFolder(work, original, GUARD)) return { ok: false, reason: "contains-workdir" };
  return { ok: true, path: joinVaultPath(work, original) };
}

function depth(path: string): number {
  return path.split("/").length;
}

/** What to create and copy to mirror the folder `from` (and everything below it, images and attachments included) at `to`.
 *  `entries` are the vault entries; those outside `from` are ignored. */
export function planWorkCopy(entries: ReadonlyArray<{ path: string; isFolder: boolean }>, from: string, to: string): CopyPlan {
  const source = normalizeVaultDir(from);
  const target = normalizeVaultDir(to);
  const prefix = `${source}/`;
  const mirror = (path: string): string => `${target}/${path.slice(prefix.length)}`;

  const folders = new Set<string>();
  const segments = target.split("/");
  for (let i = 1; i <= segments.length; i++) folders.add(segments.slice(0, i).join("/"));

  const below = entries.filter((e) => e.path.startsWith(prefix));
  const subFolders = below.filter((e) => e.isFolder).map((e) => mirror(e.path)).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const folder of subFolders) folders.add(folder);

  const files = below.filter((e) => !e.isFolder).map((e) => ({ from: e.path, to: mirror(e.path) }));
  return { folders: [...folders], files };
}
