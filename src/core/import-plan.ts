import { BOOK_FRONTMATTER_TEMPLATE } from "./frontmatter";
import { sortFolderChapters } from "./spine-parser";

export interface ImportPlan {
  bookNoteName: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function buildImportPlan(
  folderName: string,
  mdFilenames: string[],
  defaultLanguage: string
): ImportPlan {
  const chapters = sortFolderChapters(mdFilenames.filter((n) => n !== folderName));
  const body = chapters.map((n) => `![[${n}]]`).join("\n");

  const frontmatter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(BOOK_FRONTMATTER_TEMPLATE)) {
    frontmatter[k] = Array.isArray(v) ? [...(v as unknown[])] : v;
  }
  frontmatter.title = folderName;
  frontmatter.language = defaultLanguage;

  return { bookNoteName: `${folderName}.md`, frontmatter, body };
}
