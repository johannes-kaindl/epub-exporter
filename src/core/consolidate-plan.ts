import { sanitizeBase } from "./output-path";

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

  return {
    folderName,
    bookNoteName: `${folderName}.md`,
    bookNoteBody,
    chapters,
    assets: [],
    coverRewrite: null,
    skipped,
  };
}
