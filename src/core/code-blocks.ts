export interface ExtractedCode {
  lang?: string;
  text: string;
}

export function codePlaceholder(i: number): string {
  return `EPUBEXPORTERCODE${i}`;
}

const PLACEHOLDER_RE = /^EPUBEXPORTERCODE(\d+)$/;

/** Index of the placeholder this text is, or null. Counterpart to codePlaceholder(). */
export function parseCodePlaceholder(text: string): number | null {
  const m = PLACEHOLDER_RE.exec(text.trim());
  return m ? Number(m[1]) : null;
}

// Opening fence: optional indent, 3+ backticks or tildes, optional language.
const OPEN_RE = /^(\s*)(`{3,}|~{3,})(\S*)\s*$/;

export function extractCodeBlocks(md: string): { markdown: string; codes: ExtractedCode[] } {
  const lines = md.split("\n");
  const out: string[] = [];
  const codes: ExtractedCode[] = [];
  let i = 0;

  while (i < lines.length) {
    const open = OPEN_RE.exec(lines[i]);
    if (!open) { out.push(lines[i]); i++; continue; }

    const [, indent, fence, lang] = open;
    // Closing fence: same char, at least as long, nothing else on the line. This is what
    // keeps a ``` inside a ````-block from ending it early.
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;

    // Unclosed fence: not a code block. Leave the line as-is so the renderer decides.
    if (j >= lines.length) { out.push(lines[i]); i++; continue; }

    const body = lines.slice(i + 1, j).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l));
    codes.push({ lang: lang || undefined, text: body.join("\n") });

    // A fenced code block can interrupt a paragraph in CommonMark/Obsidian, so a placeholder
    // hugging adjacent text would be rendered as part of the same paragraph (soft break) rather
    // than as its own lone paragraph — which is what restoreCodeBlocks' regex requires. Pad with
    // blank lines on both sides (unless already blank) to force the placeholder into its own
    // block. Extra/duplicate blank lines are harmless in Markdown.
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(indent + codePlaceholder(codes.length - 1));
    const nextLine = lines[j + 1];
    if (nextLine !== undefined && nextLine !== "") out.push("");
    i = j + 1;
  }

  return { markdown: out.join("\n"), codes };
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

// dom-to-xhtml strips all attributes from <p> (no whitelist entry), so a lone placeholder
// paragraph is always serialized as exactly `<p>EPUBEXPORTERCODEi</p>` regardless of any
// dir/class Obsidian added — which makes this string replacement reliable.
const PLACEHOLDER_P_RE = /<p>EPUBEXPORTERCODE(\d+)<\/p>/g;

export function restoreCodeBlocks(xhtml: string, codes: ExtractedCode[]): string {
  if (codes.length === 0) return xhtml;
  return xhtml.replace(PLACEHOLDER_P_RE, (whole, n) => {
    const code = codes[Number(n)];
    if (!code) return whole;
    const langAttr = code.lang ? ` class="language-${escapeAttr(code.lang)}"` : "";
    return `<pre><code${langAttr}>${escapeText(code.text)}</code></pre>`;
  });
}
