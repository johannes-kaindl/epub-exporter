import { App } from "obsidian";
import type { DirStore } from "../vendor/kit/ensure-dir";

/** The store for code-kit `ensureDir` when the next step works on vault objects: `mkdir` goes through `vault.createFolder`, so the vault knows the
 *  folder at once (after `adapter.mkdir` it learns of it only from the file watcher, and a following `getFolderByPath` or move into it finds nothing). */
export function vaultDirStore(app: App): DirStore {
  return {
    exists: (path) => app.vault.adapter.exists(path),
    mkdir: async (path) => {
      await app.vault.createFolder(path);
    },
  };
}
