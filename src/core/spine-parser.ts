export interface SpineEntry {
  target: string; // link target inside ![[ ]], without alias/heading
}

// A chapter is a line whose *entire* trimmed content is a single embed.
const TOP_LEVEL_EMBED = /^!\[\[([^\]]+)\]\]$/;

// The single definition of "this line is a chapter", shared with spine-reorder.ts.
// Two divergent copies would let the sidebar, the export and the reordering
// disagree about which lines are chapters — a correctness hazard, not a style one.
// Returns the link target, or null when the line is not a chapter line.
export function matchEmbedLine(rawLine: string): string | null {
  const m = rawLine.trim().match(TOP_LEVEL_EMBED);
  if (!m) return null;
  const target = m[1].split("|")[0].split("#")[0].trim();
  return target || null;
}

export function parseEmbedSpine(body: string): SpineEntry[] {
  const entries: SpineEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const target = matchEmbedLine(rawLine);
    if (target) entries.push({ target });
  }
  return entries;
}

// Folder mode: natural (numeric-aware) filename sort = chapter order.
export function sortFolderChapters(filenames: string[]): string[] {
  return [...filenames].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}
