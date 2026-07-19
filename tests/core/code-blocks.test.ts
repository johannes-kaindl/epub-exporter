import { describe, it, expect } from "vitest";
import {
  extractCodeBlocks,
  codePlaceholder,
  parseCodePlaceholder,
  restoreCodeBlocks,
} from "../../src/core/code-blocks";

describe("extractCodeBlocks", () => {
  // Blank lines are required on both sides: CommonMark/Obsidian's renderer treats a fence
  // hugging adjacent text as part of the same paragraph (soft break), so without the blank-line
  // padding the placeholder would NOT come back as a lone `<p>EPUBEXPORTERCODEi</p>` and
  // restoreCodeBlocks' regex would never match it.
  it("replaces a fenced block with a placeholder and captures lang + text", () => {
    const { markdown, codes } = extractCodeBlocks("a\n```json\n{\"x\":1}\n```\nb");
    expect(markdown).toBe(`a\n\n${codePlaceholder(0)}\n\nb`);
    expect(codes).toEqual([{ lang: "json", text: '{"x":1}' }]);
  });

  it("isolates the placeholder with a blank line when a fence hugs preceding text", () => {
    const { markdown } = extractCodeBlocks("foo\n```js\nx\n```");
    const lines = markdown.split("\n");
    const idx = lines.indexOf(codePlaceholder(0));
    expect(idx).toBeGreaterThan(0);
    expect(lines[idx - 1]).toBe("");
    expect(lines[idx - 2]).toBe("foo");
  });

  it("isolates the placeholder with a blank line when a fence hugs following text", () => {
    const { markdown } = extractCodeBlocks("```js\nx\n```\nbar");
    const lines = markdown.split("\n");
    const idx = lines.indexOf(codePlaceholder(0));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(lines[idx + 1]).toBe("");
    expect(lines[idx + 2]).toBe("bar");
  });

  it("round-trips: isolated placeholder survives as lone paragraph through restoreCodeBlocks", () => {
    const { markdown, codes } = extractCodeBlocks("foo\n```js\nx\n```");
    const lines = markdown.split("\n");
    const idx = lines.indexOf(codePlaceholder(0));
    // Structural precondition the real renderer needs: blank line before, blank line after
    // (or end of doc) so the placeholder is emitted as its own paragraph.
    expect(lines[idx - 1]).toBe("");
    expect(idx === lines.length - 1 || lines[idx + 1] === "").toBe(true);

    // Simulate the renderer's lone-paragraph output for an isolated placeholder.
    const simulatedXhtml = `<p>foo</p><p>${codePlaceholder(0)}</p>`;
    const restored = restoreCodeBlocks(simulatedXhtml, codes);
    expect(restored).toBe("<p>foo</p><pre><code class=\"language-js\">x</code></pre>");
  });

  it("does not duplicate blank lines when the fence is already isolated", () => {
    const { markdown } = extractCodeBlocks("a\n\n```json\n{\"x\":1}\n```\n\nb");
    expect(markdown).toBe(`a\n\n${codePlaceholder(0)}\n\nb`);
  });

  it("keeps an inner shorter fence from closing an outer longer fence", () => {
    const { codes } = extractCodeBlocks("````\n```\nnested\n```\n````");
    expect(codes).toEqual([{ lang: undefined, text: "```\nnested\n```" }]);
  });

  it("leaves an unclosed fence untouched (renderer decides)", () => {
    const { markdown, codes } = extractCodeBlocks("```\nno end");
    expect(markdown).toBe("```\nno end");
    expect(codes).toEqual([]);
  });
});

describe("parseCodePlaceholder", () => {
  it("round-trips codePlaceholder", () => {
    expect(parseCodePlaceholder(codePlaceholder(3))).toBe(3);
    expect(parseCodePlaceholder("not a placeholder")).toBeNull();
  });
});

describe("restoreCodeBlocks", () => {
  it("rebuilds a <pre><code> block with escaped content and a language class", () => {
    const codes = [{ lang: "js", text: "const a = 1 < 2 && 3 > 2;" }];
    const out = restoreCodeBlocks(`<h1>x</h1><p>${codePlaceholder(0)}</p>`, codes);
    expect(out).toBe(
      '<h1>x</h1><pre><code class="language-js">const a = 1 &lt;' +
        " 2 &amp;&amp; 3 &gt; 2;</code></pre>"
    );
  });

  it("omits the language class when lang is absent", () => {
    const out = restoreCodeBlocks(`<p>${codePlaceholder(0)}</p>`, [{ text: "x" }]);
    expect(out).toBe("<pre><code>x</code></pre>");
  });

  it("is a no-op when there are no codes", () => {
    expect(restoreCodeBlocks("<p>hi</p>", [])).toBe("<p>hi</p>");
  });
});
