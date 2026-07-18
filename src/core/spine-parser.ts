export interface SpineEntry {
  target: string; // link target inside ![[ ]], without alias/heading
}

// A chapter is a line whose *entire* trimmed content is a single embed.
const TOP_LEVEL_EMBED = /^!\[\[([^\]]+)\]\]$/;

export function parseEmbedSpine(body: string): SpineEntry[] {
  const entries: SpineEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const m = rawLine.trim().match(TOP_LEVEL_EMBED);
    if (m) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      if (target) entries.push({ target });
    }
  }
  return entries;
}

// Folder mode: natural (numeric-aware) filename sort = chapter order.
export function sortFolderChapters(filenames: string[]): string[] {
  return [...filenames].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}
