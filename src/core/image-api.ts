/**
 * Our view of local-image-generator's public API (Provider-API v1).
 *
 * Deliberately re-declared here instead of imported from that repo: these are
 * separate plugins with separate release cycles, and a type import would turn a
 * loose runtime coupling into a build-time one. Only the parts we actually use
 * are declared — `save()`, img2img and progress-free extras are left out on
 * purpose, so this file cannot drift into a second copy of their contract.
 */

/** States the provider reports as values rather than throwing. */
export type ImageApiFailure =
  | "busy"
  | "not-configured"
  | "unreachable"
  | "model-not-downloaded"
  | "no-gpu";

export interface ImageApiCapabilities {
  negativePrompt: boolean;
  cfg: boolean;
  maxSteps: number;
  fixedSize: { width: number; height: number } | null;
  /** Allowed sizes, or null when the backend accepts any (server mode). */
  sizes: readonly { width: number; height: number }[] | null;
}

export interface ImageApiStatus {
  apiVersion: number;
  engine: "builtin" | "server";
  /** Synchronous and network-free — may be stale in server mode. */
  ready: boolean;
  reason: ImageApiFailure | null;
  capabilities: ImageApiCapabilities;
}

export interface ImageApiRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  onProgress?: (pct: number | null, phase: "loading-model" | "generating") => void;
}

export type ImageApiResult =
  | { ok: true; image: { base64: string; params: { seed: number } } }
  | { ok: false; reason: ImageApiFailure }
  | { ok: false; reason: "failed"; message: string };

export interface ImageApi {
  readonly apiVersion: number;
  status(): ImageApiStatus;
  /** Added in LIG 0.10.0 — additive, so apiVersion stayed 1 and this may be absent. */
  recheck?(): Promise<ImageApiStatus>;
  generate(req: ImageApiRequest): Promise<ImageApiResult>;
}

/** The version of the provider contract this plugin is written against. */
export const SUPPORTED_IMAGE_API_VERSION = 1;

export interface CoverSize {
  width: number;
  height: number;
}

/**
 * Portrait sizes to offer when the backend accepts any (server mode).
 *
 * Book covers are portrait; offering squares first would make the common case
 * the extra click. These are SDXL-friendly dimensions, so a default server
 * setup produces them without an awkward resize.
 */
const PORTRAIT_DEFAULTS: readonly CoverSize[] = [
  { width: 832, height: 1216 },
  { width: 1024, height: 1536 },
];

/**
 * The sizes a cover may actually be produced in, according to the backend.
 *
 * This is the neighbour's Keine-Attrappen line applied to our own UI: sd-turbo
 * can only do 512x512, and a picker that lists 1024x1536 anyway is a control
 * that lies. `capabilities.sizes` is the authority; null means free choice.
 */
export function coverSizeOptions(caps: ImageApiCapabilities): readonly CoverSize[] {
  if (caps.sizes && caps.sizes.length > 0) return caps.sizes;
  if (caps.fixedSize) return [caps.fixedSize];
  return PORTRAIT_DEFAULTS;
}

/** The largest offered size — a cover is the one image in a book worth pixels. */
export function defaultCoverSize(caps: ImageApiCapabilities): CoverSize {
  const options = coverSizeOptions(caps);
  return options.reduce((best, s) => (s.width * s.height > best.width * best.height ? s : best));
}

/**
 * Resolves the provider's readiness, refreshing it only when that can help.
 *
 * `status()` is network-free by contract, which means a server that started
 * after Obsidian did reports `unreachable` forever. `recheck()` costs one
 * request and fixes exactly that case — so it is spent on exactly that case.
 * The other failure reasons are facts about this machine (no GPU, no model, no
 * endpoint configured) or about right now (busy); asking the network about them
 * buys nothing and makes a button feel slow for no reason.
 */
export async function ensureImageApiReady(api: ImageApi): Promise<ImageApiStatus> {
  const first = api.status();
  if (first.ready) return first;
  if (first.reason !== "unreachable") return first;
  // Absent in LIG 0.7.0-0.9.0, which report the same apiVersion. The stale
  // state is then the only answer we have — still an answer, not a crash.
  if (typeof api.recheck !== "function") return first;
  return await api.recheck();
}
