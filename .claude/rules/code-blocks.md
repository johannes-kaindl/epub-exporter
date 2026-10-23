---
paths:
  - "src/core/code-blocks.ts"
  - "src/core/dom-to-xhtml.ts"
  - "src/obsidian/book-assembler.ts"
---

# Code-Block-Hijack-Guard

- **`MarkdownRenderer.render` führt alle registrierten Markdown-Prozessoren fremder Plugins aus** → `<pre>` wird durch Widget-DOM ersetzt, der Originalcode ist nicht rekonstruierbar. Fenced-Code wird deshalb **vor** dem Rendern rausgezogen (Platzhalter mit Leerzeilen isoliert — sonst geht er verloren, wenn ein Fence an einer Textzeile klebt) und **nach** `dom-to-xhtml` wieder eingesetzt (`src/core/code-blocks.ts`).
