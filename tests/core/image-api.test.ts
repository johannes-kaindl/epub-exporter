import { describe, it, expect } from "vitest";
import {
  coverSizeOptions,
  defaultCoverSize,
  ensureImageApiReady,
  type ImageApi,
  type ImageApiStatus,
} from "../../src/core/image-api";

const caps = {
  negativePrompt: false,
  cfg: false,
  maxSteps: 4,
  fixedSize: { width: 512, height: 512 },
  sizes: [{ width: 512, height: 512 }],
};

function status(over: Partial<ImageApiStatus> = {}): ImageApiStatus {
  return { apiVersion: 1, engine: "server", ready: true, reason: null, capabilities: caps, ...over };
}

/** Counts recheck() calls so a test can assert the network was NOT touched. */
function api(first: ImageApiStatus, after?: ImageApiStatus) {
  let rechecks = 0;
  const obj: ImageApi & { rechecks: () => number } = {
    apiVersion: 1,
    status: () => first,
    recheck: after
      ? async () => {
          rechecks++;
          return after;
        }
      : undefined,
    generate: async () => ({ ok: false, reason: "busy" }),
    rechecks: () => rechecks,
  };
  return obj;
}

describe("ensureImageApiReady", () => {
  it("reports a ready provider without rechecking", async () => {
    const a = api(status());
    expect((await ensureImageApiReady(a)).ready).toBe(true);
    expect(a.rechecks()).toBe(0);
  });

  it("rechecks exactly once when a stale 'unreachable' is blocking", async () => {
    // status() is network-free by contract, so a server that came up after
    // Obsidian did stays "unreachable" forever unless someone asks again.
    const a = api(status({ ready: false, reason: "unreachable" }), status());
    expect((await ensureImageApiReady(a)).ready).toBe(true);
    expect(a.rechecks()).toBe(1);
  });

  it("does not recheck for a reason a network call cannot heal", async () => {
    // "no-gpu" and "model-not-downloaded" are facts about this machine. Asking
    // the network about them spends a round trip to learn nothing.
    for (const reason of ["no-gpu", "model-not-downloaded", "not-configured", "busy"] as const) {
      const a = api(status({ ready: false, reason }), status());
      const res = await ensureImageApiReady(a);
      expect(res.ready).toBe(false);
      expect(res.reason).toBe(reason);
      expect(a.rechecks()).toBe(0);
    }
  });

  it("survives an installation without recheck()", async () => {
    // LIG 0.7.0-0.9.0 report apiVersion 1 and have no recheck. The stale state
    // is then the only answer available — but it must be an answer, not a crash.
    const a = api(status({ ready: false, reason: "unreachable" }));
    const res = await ensureImageApiReady(a);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe("unreachable");
  });
});

describe("coverSizeOptions", () => {
  it("offers exactly the sizes the backend allows", () => {
    // The Keine-Attrappen line, applied to a neighbour's capabilities: a size
    // picker listing 1024x1536 against sd-turbo would be a control that lies.
    expect(coverSizeOptions({ ...caps, sizes: [{ width: 512, height: 512 }] }))
      .toEqual([{ width: 512, height: 512 }]);
  });

  it("keeps all allowed sizes when there are several", () => {
    const sizes = [{ width: 512, height: 512 }, { width: 1024, height: 1024 }];
    expect(coverSizeOptions({ ...caps, sizes })).toEqual(sizes);
  });

  it("offers portrait defaults when the backend accepts any size", () => {
    // sizes === null means server mode: free choice. A cover is portrait, so
    // the offer is portrait — the user is choosing a book cover, not an image.
    const opts = coverSizeOptions({ ...caps, sizes: null, fixedSize: null });
    expect(opts.length).toBeGreaterThan(0);
    for (const s of opts) expect(s.height).toBeGreaterThan(s.width);
  });
});

describe("defaultCoverSize", () => {
  it("prefers the largest offered size", () => {
    const sizes = [{ width: 512, height: 512 }, { width: 1024, height: 1024 }];
    expect(defaultCoverSize({ ...caps, sizes })).toEqual({ width: 1024, height: 1024 });
  });

  it("falls back to the single allowed size", () => {
    expect(defaultCoverSize({ ...caps, sizes: [{ width: 512, height: 512 }] }))
      .toEqual({ width: 512, height: 512 });
  });
});
