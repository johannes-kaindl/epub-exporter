import { type ImageApi, SUPPORTED_IMAGE_API_VERSION } from "../core/image-api";

const PLUGIN_ID = "local-image-generator";

/**
 * Reads local-image-generator's public API out of the plugin registry, defensively.
 *
 * Read on EVERY use rather than cached at load: the neighbouring plugin can be
 * enabled or disabled while Obsidian runs, and the lookup is a property access.
 * The parameter is `unknown` because `app.plugins` is not part of Obsidian's
 * published types — every step towards it is checked separately so a missing
 * link yields null instead of throwing in the middle of a user's export.
 *
 * `recheck()` is deliberately NOT required: it arrived in LIG 0.10.0 as an
 * additive change, so a 0.7.0 installation reports the same `apiVersion` and
 * generates perfectly well. Callers that want it test for it themselves.
 */
export function readImageApi(app: unknown): ImageApi | null {
  const reg = (app as { plugins?: { plugins?: Record<string, unknown> } } | null | undefined)
    ?.plugins?.plugins;
  if (reg === null || typeof reg !== "object") return null;

  const api = (reg[PLUGIN_ID] as { api?: unknown } | undefined)?.api as ImageApi | undefined;
  if (!api || api.apiVersion !== SUPPORTED_IMAGE_API_VERSION) return null;

  // Shape, not just presence: the version number is a claim the object makes
  // about itself, and a half-initialised one makes it just as loudly.
  const complete = typeof api.status === "function" && typeof api.generate === "function";
  return complete ? api : null;
}
