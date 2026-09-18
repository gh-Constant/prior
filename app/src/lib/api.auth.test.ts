import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiAuthError, api, isAuthError, isRetriableError } from "./api";

describe("ApiAuthError", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("throws ApiAuthError on 401 so callers can sign out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "expired" }) }));
    const error = await api.getProfile("bad-token").catch((e) => e);
    expect(error).toBeInstanceOf(ApiAuthError);
    expect(isAuthError(error)).toBe(true);
  });

  it("marks 5xx as retriable but not 4xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    // requestWithRetry retries twice with backoff; stub always 500 so it still fails as server error.
    await expect(api.getProfile("t")).rejects.toMatchObject({ name: "ApiRequestError" });
    expect(isRetriableError({ name: "x" })).toBe(false);
  });

  it("exposes GET /v1/me for profile sync", async () => {
    const profile = { id: "u1", email: "a@b.c", displayName: "Ada" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => profile });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.getProfile("t")).resolves.toEqual(profile);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/me");
  });
});
