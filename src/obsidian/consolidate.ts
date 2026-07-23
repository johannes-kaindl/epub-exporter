import { ConsolidatePlan, ChapterMode } from "../core/consolidate-plan";
import { rewriteImageRefs } from "../core/image-refs";

export interface ConsolidatePort {
  createFolder(path: string): Promise<void>;
  readBody(path: string): Promise<string>;
  copyFile(sourcePath: string, targetPath: string): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  copyBinary(sourcePath: string, targetPath: string): Promise<void>;
}

export interface ConsolidateContext {
  mode: ChapterMode;
  bookNoteSourcePath: string;
  bookNoteFrontmatter: string;
}

export interface ConsolidateResult {
  folderPath: string;
  chapterCount: number;
  assetCount: number;
  errors: string[];
}

// Rewrite the cover value inside a raw frontmatter block. Matches `cover:` (or its
// German alias `titelbild:`) and replaces the rest of the line with a quoted wikilink.
function applyCoverRewrite(fm: string, cover: string | null): string {
  if (!cover) return fm;
  const line = new RegExp(`^(\\s*(?:cover|titelbild)\\s*:).*$`, "mi");
  if (line.test(fm)) return fm.replace(line, `$1 "${cover}"`);
  // No cover key present: inject one before the closing fence.
  return fm.replace(/\n---\s*$/, `\ncover: "${cover}"\n---`);
}

export async function executeConsolidatePlan(
  port: ConsolidatePort,
  plan: ConsolidatePlan,
  ctx: ConsolidateContext
): Promise<ConsolidateResult> {
  const errors: string[] = [];
  const folder = plan.folderName;
  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  await run("create folder", () => port.createFolder(folder));
  if (plan.assets.length) await run("create _assets", () => port.createFolder(`${folder}/_assets`));

  let chapterCount = 0;
  for (const ch of plan.chapters) {
    const target = `${folder}/${ch.targetName}`;
    await run(`chapter ${ch.targetName}`, async () => {
      if (ctx.mode === "move") await port.moveFile(ch.sourcePath, target);
      else await port.copyFile(ch.sourcePath, target);
      if (ch.rewrites.length) {
        const body = await port.readBody(target);
        await port.writeFile(target, rewriteImageRefs(body, ch.rewrites));
      }
      chapterCount++;
    });
  }

  let assetCount = 0;
  for (const a of plan.assets) {
    await run(`asset ${a.targetName}`, async () => {
      await port.copyBinary(a.sourcePath, `${folder}/${a.targetName}`);
      assetCount++;
    });
  }

  await run("folder note", async () => {
    const fm = applyCoverRewrite(ctx.bookNoteFrontmatter, plan.coverRewrite);
    const content = fm ? `${fm}\n${plan.bookNoteBody}` : plan.bookNoteBody;
    const target = `${folder}/${plan.bookNoteName}`;
    if (ctx.mode === "move") await port.moveFile(ctx.bookNoteSourcePath, target);
    await port.writeFile(target, content);
  });

  return { folderPath: folder, chapterCount, assetCount, errors };
}
