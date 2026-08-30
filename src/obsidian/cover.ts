import { App, TFile, base64ToArrayBuffer, normalizePath } from "obsidian";
import { setCoverPath, splitFrontmatter } from "../core/frontmatter";
import { ensureImageApiReady, type ImageApi, type ImageApiFailure } from "../core/image-api";

/**
 * Everything this flow needs from the vault, injected so the order of
 * operations can be tested without Obsidian — the order is the whole point
 * here (see `generateCoverFor`).
 */
export interface CoverPort {
  exists(path: string): boolean;
  /** `base64` is a bare PNG payload, no `data:` prefix — decoding belongs to the adapter. */
  writeBinary(path: string, base64: string): Promise<void>;
  updateFrontmatter(notePath: string, fn: (frontmatter: string) => string): Promise<void>;
}

export interface CoverInput {
  notePath: string;
  prompt: string;
  width: number;
  height: number;
  onProgress?: (pct: number | null, phase: "loading-model" | "generating") => void;
}

export type CoverResult =
  | { ok: true; imagePath: string; seed: number }
  | { ok: false; reason: ImageApiFailure | "failed"; message?: string };

/** `Books/Salt Marsh.md` → `Books/Salt Marsh cover.png`, dodging existing files. */
function freeCoverPath(port: CoverPort, notePath: string): string {
  const base = notePath.replace(/\.md$/i, "");
  let candidate = `${base} cover.png`;
  for (let n = 2; port.exists(candidate); n++) candidate = `${base} cover ${n}.png`;
  return candidate;
}

/**
 * Generates a cover, stores it in the vault and points the book note at it.
 *
 * The order matters and is what the tests pin down: readiness, then generation,
 * then the write, then the note. Nothing touches the vault until an image
 * actually exists — a `cover:` key pointing at a file that was never written
 * turns a working export into a broken one, which is worse than no cover.
 *
 * The image goes into the vault rather than straight into the EPUB because this
 * plugin's premise is that the book note IS the book: a cover only the exporter
 * can see is invisible in reading mode, and an unseeded regeneration would give
 * the same book a different cover on every export.
 */
export async function generateCoverFor(
  port: CoverPort,
  api: ImageApi,
  input: CoverInput
): Promise<CoverResult> {
  const state = await ensureImageApiReady(api);
  if (!state.ready) return { ok: false, reason: state.reason ?? "failed" };

  const result = await api.generate({
    prompt: input.prompt,
    width: input.width,
    height: input.height,
    onProgress: input.onProgress,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, message: "message" in result ? result.message : undefined };
  }

  const imagePath = freeCoverPath(port, input.notePath);
  await port.writeBinary(imagePath, result.image.base64);
  await port.updateFrontmatter(input.notePath, (fm) => setCoverPath(fm, imagePath));

  return { ok: true, imagePath, seed: result.image.params.seed };
}

/**
 * The real vault side of `CoverPort`.
 *
 * `writeBinary` decodes here rather than in the flow so the flow stays free of
 * Obsidian: `base64ToArrayBuffer` is an Obsidian export, and the provider hands
 * out base64 precisely so it can cross a plugin boundary as a plain string.
 *
 * `updateFrontmatter` goes through `vault.process`, not read-then-modify: the
 * panel writes to the same note when chapters are reordered, and process is the
 * atomic read-modify-write the rest of this plugin already uses for that reason.
 */
export function createCoverPort(app: App): CoverPort {
  return {
    exists(path) {
      return app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
    },
    async writeBinary(path, base64) {
      await app.vault.createBinary(normalizePath(path), base64ToArrayBuffer(base64));
    },
    async updateFrontmatter(notePath, fn) {
      const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
      if (!(file instanceof TFile)) return;
      await app.vault.process(file, (content) => {
        const { head, body } = splitFrontmatter(content);
        // A note without frontmatter is not a book note and cannot reach this
        // flow — but if it ever did, inventing a block here would be a surprise.
        if (!head) return content;
        return fn(head.trimEnd()) + "\n" + body;
      });
    },
  };
}
