import type { App, TFile } from "obsidian";
import { BOOK_FRONTMATTER_TEMPLATE } from "../core/frontmatter";
import type { FmValue } from "../vendor/kit/frontmatter";
import { patchFrontmatter, type FmLiteral, type FrontmatterPatchResult } from "../vendor/kit/frontmatter-patch";

export type InsertFrontmatterResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: Extract<FrontmatterPatchResult, { ok: false }>["reason"] };

/**
 * The template as the kit's patch wants it. The kit's value type has no boolean: `epub: true` goes in as a literal so it stays a YAML
 * boolean in the note (a string would be quoted, and `isBookNote` would still accept it, but the properties editor would show text).
 */
function templateFields(): Record<string, FmValue | FmLiteral> {
  const out: Record<string, FmValue | FmLiteral> = {};
  for (const [key, value] of Object.entries(BOOK_FRONTMATTER_TEMPLATE)) {
    if (typeof value === "boolean") out[key] = { literal: String(value) };
    else out[key] = Array.isArray(value) ? [...(value as string[])] : (value as FmValue);
  }
  return out;
}

/**
 * Adds the book template to a note: each field only if absent, never an overwrite.
 *
 * Works on the note's text and not through `processFrontMatter`, which re-serialises the whole block: it turns `foo: [a, b]` into a block
 * list and drops comments (measured 2026-10-25 on plugin 0.7.0). Here the note's own lines stay byte for byte, and the line ending of the
 * note is kept. A block the kit cannot read (a fence that never closes) is left as it is and reported, never rewritten.
 */
export async function insertBookFrontmatter(app: App, file: TFile): Promise<InsertFrontmatterResult> {
  let result: InsertFrontmatterResult = { ok: true, changed: false };
  await app.vault.process(file, (text) => {
    const patched = patchFrontmatter(text, { ensure: templateFields(), create: true, protect: [] });
    if (!patched.ok) {
      result = { ok: false, reason: patched.reason };
      return text;
    }
    result = { ok: true, changed: patched.changed };
    return patched.content;
  });
  return result;
}
