import { describe, it, expect } from "vitest";
import { generateUrnUuid } from "../../src/core/uuid";

describe("generateUrnUuid", () => {
  it("produces a v4 urn:uuid with correct shape", () => {
    const u = generateUrnUuid(() => 0.5);
    expect(u).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("is deterministic for a fixed rng", () => {
    expect(generateUrnUuid(() => 0.5)).toBe(generateUrnUuid(() => 0.5));
  });
});
