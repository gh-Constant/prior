import { describe, expect, it } from "vitest";
import { generateUuid, isValidUuid } from "./uuid";

describe("uuid", () => {
  it("generates valid RFC4122 v4 UUIDs", () => {
    const id = generateUuid();
    expect(isValidUuid(id)).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("validates valid UUIDs and rejects invalid ones", () => {
    expect(isValidUuid("e0000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isValidUuid("c8a5b28d-176a-49eb-a436-1e6ef83424d6")).toBe(true);
    expect(isValidUuid("prior-seed-welcome-note")).toBe(false);
    expect(isValidUuid("12345")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });
});
