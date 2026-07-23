import { describe, it, expect } from "vitest";
import { reorderSpine } from "../../src/core/spine-reorder";

const BODY = ["# Buch", "", "![[Vorwort]]", "![[Kapitel 1]]", "![[Kapitel 2]]", "", "Nachwort-Prosa"].join("\n");

function bodyOf(res: ReturnType<typeof reorderSpine>): string {
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}`);
  return res.body;
}

describe("reorderSpine", () => {
  it("moves a chapter down", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 2, 3));
    expect(out.split("\n").slice(2, 5)).toEqual(["![[Kapitel 1]]", "![[Kapitel 2]]", "![[Vorwort]]"]);
  });

  it("moves a chapter up", () => {
    const out = bodyOf(reorderSpine(BODY, 2, 0, 3));
    expect(out.split("\n").slice(2, 5)).toEqual(["![[Kapitel 2]]", "![[Vorwort]]", "![[Kapitel 1]]"]);
  });

  it("preserves an alias — the whole point of moving raw lines", () => {
    const body = ["![[Kapitel 1|Vorwort]]", "![[Kapitel 2]]"].join("\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[Kapitel 2]]", "![[Kapitel 1|Vorwort]]"].join("\n"));
  });

  it("preserves a heading suffix", () => {
    const body = ["![[Kapitel 1#Teil A]]", "![[Kapitel 2]]"].join("\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[Kapitel 2]]", "![[Kapitel 1#Teil A]]"].join("\n"));
  });

  it("leaves prose between chapters exactly where it was", () => {
    const body = ["![[A]]", "Zwischentext", "![[B]]"].join("\n");
    // Only the two embed slots swap; "Zwischentext" keeps its line.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "Zwischentext", "![[A]]"].join("\n"));
  });

  it("leaves leading and trailing prose untouched", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 1, 3));
    const lines = out.split("\n");
    expect(lines[0]).toBe("# Buch");
    expect(lines[1]).toBe("");
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("Nachwort-Prosa");
  });

  it("keeps the line count identical", () => {
    const out = bodyOf(reorderSpine(BODY, 0, 2, 3));
    expect(out.split("\n")).toHaveLength(BODY.split("\n").length);
  });

  it("preserves CRLF line endings", () => {
    const body = ["![[A]]", "![[B]]"].join("\r\n");
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "![[A]]"].join("\r\n"));
  });

  it("uses the predominant style (LF) instead of upgrading every line to CRLF when mixed", () => {
    // Four bare-LF breaks vs. one CRLF break — LF predominates. The single
    // \r\n must not spread to the rest of the file once the body is rejoined.
    const body = "![[A]]\nZwischentext\n![[B]]\r\n![[C]]\nNachwort\n";
    const out = bodyOf(reorderSpine(body, 0, 1, 3));
    expect(out).toBe("![[B]]\nZwischentext\n![[A]]\n![[C]]\nNachwort\n");
  });

  it("handles indented embed lines", () => {
    const body = ["  ![[A]]", "![[B]]"].join("\n");
    // The raw line moves verbatim, indentation and all.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["![[B]]", "  ![[A]]"].join("\n"));
  });

  it("reports noop when the chapter is dropped on itself", () => {
    expect(reorderSpine(BODY, 1, 1, 3)).toEqual({ ok: false, reason: "noop" });
  });

  it("reports conflict when the note gained a chapter behind our back", () => {
    // Panel showed 2 chapters, the file now has 3 → indices are meaningless.
    expect(reorderSpine(BODY, 0, 1, 2)).toEqual({ ok: false, reason: "conflict" });
  });

  it("reports out-of-range for an index past the end", () => {
    expect(reorderSpine(BODY, 0, 3, 3)).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("ignores embed-looking text that is not a whole line", () => {
    const body = ["Siehe ![[A]] dort", "![[B]]", "![[C]]"].join("\n");
    // Only B and C are chapters; expectedCount is therefore 2.
    expect(bodyOf(reorderSpine(body, 0, 1, 2))).toBe(["Siehe ![[A]] dort", "![[C]]", "![[B]]"].join("\n"));
  });
});
