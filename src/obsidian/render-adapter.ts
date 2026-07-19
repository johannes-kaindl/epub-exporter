import { App, Component, MarkdownRenderer } from "obsidian";

export interface RenderedMarkdown {
  root: HTMLElement;
  dispose: () => void;
}

// Render a note's markdown body to a detached DOM subtree. The caller MUST call
// dispose() when done (unloads the render Component and its post-processors).
// Pattern mirrors obsidian-paperize / obsidian-letterhead: a detached createDiv()
// as the container, a throwaway Component as lifecycle owner, awaited render.
export async function renderMarkdownToDom(
  app: App,
  markdown: string,
  sourcePath: string
): Promise<RenderedMarkdown> {
  const root = createDiv();
  const comp = new Component();
  await MarkdownRenderer.render(app, markdown, root, sourcePath, comp);
  return { root, dispose: () => comp.unload() };
}
