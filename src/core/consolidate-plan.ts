import { sanitizeBase } from "./output-path";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

interface AssetPlanState {
  assets: AssetCopy[];
  bySource: Map<string, string>; // source vault path -> "_assets/<finalName>"
  usedNames: Set<string>;        // final _assets/ names already taken
}

// Register a source path as an _assets/ copy, de-colliding the basename. Idempotent per source.
function registerAsset(state: AssetPlanState, sourcePath: string): string {
  const existing = state.bySource.get(sourcePath);
  if (existing) return existing;
  const [stem, ext] = splitExt(basename(sourcePath));
  let name = `${stem}${ext}`;
  for (let n = 2; state.usedNames.has(name); n++) name = `${stem} (${n})${ext}`;
  state.usedNames.add(name);
  const target = `_assets/${name}`;
  state.assets.push({ sourcePath, targetName: target });
  state.bySource.set(sourcePath, target);
  return target;
}

export type ChapterMode = "copy" | "move";
export type AssetMode = "full" | "cover" | "none";

export interface ResolvedImageRef {
  raw: string;
  resolvedPath: string | null;
}
export interface ConsolidateChapterInput {
  sourcePath: string | null;
  title: string;
  imageRefs: ResolvedImageRef[];
}
export interface ConsolidateInput {
  bookTitle: string;
  chapters: ConsolidateChapterInput[];
  leadingProse: string;
  coverPath: string | null;
  assetMode: AssetMode;
  existingFolderNames: string[];
}
export interface AssetCopy {
  sourcePath: string;
  targetName: string;
}
export interface PlannedChapterOp {
  sourcePath: string;
  targetName: string;
  rewrites: Array<{ from: string; to: string }>;
}
export interface ConsolidatePlan {
  folderName: string;
  bookNoteName: string;
  bookNoteBody: string;
  chapters: PlannedChapterOp[];
  assets: AssetCopy[];
  coverRewrite: string | null;
  skipped: number;
}

function uniqueFolderName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function buildConsolidatePlan(input: ConsolidateInput): ConsolidatePlan {
  const folderName = uniqueFolderName(sanitizeBase(input.bookTitle), input.existingFolderNames);

  const present = input.chapters.filter(
    (c): c is ConsolidateChapterInput & { sourcePath: string } => c.sourcePath !== null
  );
  const skipped = input.chapters.length - present.length;
  const width = Math.max(2, String(present.length).length);

  const chapters: PlannedChapterOp[] = present.map((c, i) => {
    const num = String(i + 1).padStart(width, "0");
    return {
      sourcePath: c.sourcePath,
      targetName: `${num} - ${sanitizeBase(c.title)}.md`,
      rewrites: [],
    };
  });

  const embedLines = chapters
    .map((c) => `![[${c.targetName.replace(/\.md$/i, "")}]]`)
    .join("\n");
  const prose = input.leadingProse.trim();
  const bookNoteBody = prose ? `${prose}\n\n${embedLines}` : embedLines;

  const assetState: AssetPlanState = { assets: [], bySource: new Map(), usedNames: new Set() };
  let coverRewrite: string | null = null;

  if (input.assetMode !== "none" && input.coverPath) {
    const target = registerAsset(assetState, input.coverPath);
    coverRewrite = `[[${target}]]`;
  }

  if (input.assetMode === "full") {
    present.forEach((c, i) => {
      for (const ref of c.imageRefs) {
        if (!ref.resolvedPath) continue;
        const target = registerAsset(assetState, ref.resolvedPath);
        chapters[i].rewrites.push({ from: ref.raw, to: target });
      }
    });
  }

  return {
    folderName,
    bookNoteName: `${folderName}.md`,
    bookNoteBody,
    chapters,
    assets: assetState.assets,
    coverRewrite,
    skipped,
  };
}
