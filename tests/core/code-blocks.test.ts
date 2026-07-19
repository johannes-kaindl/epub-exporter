import { describe, it, expect } from "vitest";
import {
  extractCodeBlocks,
  codePlaceholder,
  parseCodePlaceholder,
  restoreCodeBlocks,
} from "../../src/core/code-blocks";

describe("extractCodeBlocks", () => {
  it("replaces a fenced block with a placeholder and captures lang + text", () => {
    const { markdown, codes } = extractCodeBlocks("a\n```json\n{\"x\":1}\n```\nb");
    expect(markdown).toBe(`a\n${codePlaceholder(0)}\nb`);
    expect(codes).toEqual([{ lang: "json", text: '{"x":1}' }]);
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
