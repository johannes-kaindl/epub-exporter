import { describe, it, expect } from "vitest";
import { readImageApi } from "../../src/obsidian/image-api";

/** A minimally complete stand-in for local-image-generator's public API. */
function fakeApi(over: Record<string, unknown> = {}) {
  return {
    apiVersion: 1,
    status: () => ({ ready: true, reason: null }),
    recheck: async () => ({ ready: true, reason: null }),
    generate: async () => ({ ok: true }),
    ...over,
  };
}

function appWith(api: unknown) {
  return { plugins: { plugins: { "local-image-generator": { api } } } };
}

describe("readImageApi", () => {
  it("returns the api when the plugin is present and complete", () => {
    const api = fakeApi();
    expect(readImageApi(appWith(api))).toBe(api);
  });

  it("returns null when the plugin is not installed", () => {
    expect(readImageApi({ plugins: { plugins: {} } })).toBeNull();
  });

  it("returns null when there is no plugin registry at all", () => {
    // Not a hypothetical: `app.plugins` is not part of Obsidian's public types,
    // so every step towards it has to survive being absent.
    expect(readImageApi({})).toBeNull();
    expect(readImageApi(null)).toBeNull();
    expect(readImageApi(undefined)).toBeNull();
  });

  it("returns null for an api version it was not built against", () => {
    expect(readImageApi(appWith(fakeApi({ apiVersion: 2 })))).toBeNull();
  });

  it("returns null when a required method is missing", () => {
    // Version and shape are separate claims. A half-initialised or foreign
    // object under the same key carries the right number and still cannot
    // generate anything — checking only the version lets it through.
    expect(readImageApi(appWith(fakeApi({ generate: undefined })))).toBeNull();
    expect(readImageApi(appWith(fakeApi({ status: "not a function" })))).toBeNull();
  });

  it("accepts an installation without recheck()", () => {
    // recheck() arrived in LIG 0.10.0 and is additive — apiVersion stayed 1.
    // Requiring it would reject 0.7.0-0.9.0, which can generate perfectly well.
    const api = fakeApi({ recheck: undefined });
    expect(readImageApi(appWith(api))).toBe(api);
  });
});
