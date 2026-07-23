import { matchEmbedLine } from "./spine-parser";

export type ReorderResult =
  | { ok: true; body: string }
  | { ok: false; reason: "noop" | "out-of-range" | "conflict" };

// Reorder the embed spine by MOVING RAW LINES between their existing slots.
//
// Never rebuild an embed line from a parsed target: parseEmbedSpine drops alias
// and heading (`![[A|Alias]]` → "A"), so regenerating would silently destroy
// them — the same bug class the Phase-2 review caught in rewriteImageRefs.
// Because only the *contents* of the embed slots are permuted, everything else
// (prose, headings, blank lines, indentation) stays byte-identical and the line
// count is unchanged.
//
// `expectedCount` is the conflict guard: it is the number of chapters the panel
// was showing. If the file disagrees at write time, someone edited the note in
// between and the caller's indices no longer mean anything.
export function reorderSpine(
  body: string,
  from: number,
  to: number,
  expectedCount: number
): ReorderResult {
  if (from === to) return { ok: false, reason: "noop" };

  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  const slots: number[] = [];
  lines.forEach((line, i) => {
    if (matchEmbedLine(line) !== null) slots.push(i);
  });

  if (slots.length !== expectedCount) return { ok: false, reason: "conflict" };
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) {
    return { ok: false, reason: "out-of-range" };
  }

  const raw = slots.map((i) => lines[i]);
  const [moved] = raw.splice(from, 1);
  raw.splice(to, 0, moved);
  slots.forEach((lineIndex, slot) => {
    lines[lineIndex] = raw[slot];
  });

  return { ok: true, body: lines.join(eol) };
}
