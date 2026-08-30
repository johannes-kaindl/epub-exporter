/**
 * Turns a book's own metadata into a prompt for an image generator.
 *
 * Pure on purpose: this module knows nothing about Obsidian and nothing about
 * the generator's API. It answers one question — *what should be drawn?* — and
 * the answer belongs to the book note, which is this plugin's source of truth.
 */

export interface CoverPromptInput {
  title: string;
  authors: string[];
  /** Raw `cover_prompt:` value from the book note, if the user wrote one. */
  coverPrompt?: string;
}

/**
 * A stored prompt wins verbatim; otherwise one is built from title and author.
 *
 * The generated fallback stays deliberately plain. A longer, more "artistic"
 * template would read as this plugin having an opinion about how books should
 * look — that opinion belongs to the user, in `cover_prompt:`.
 */
export function buildCoverPrompt(input: CoverPromptInput): string {
  const stored = input.coverPrompt?.trim();
  if (stored) return stored;

  const authors = input.authors.filter((a) => a.trim() !== "");
  const byline = authors.length > 0 ? `, by ${authors.join(", ")}` : "";
  return `book cover art for "${input.title}"${byline}`;
}
