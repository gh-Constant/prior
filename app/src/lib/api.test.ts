import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("OAuth code exchange", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("aborts a stalled exchange and returns an actionable error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const failure = expect(api.exchange("one-use-code")).rejects.toThrow("Sign-in timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves API errors and clears the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "invalid or expired exchange code" }) }));
    await expect(api.exchange("expired-code")).rejects.toThrow("invalid or expired exchange code");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns the session and clears the timeout after a successful exchange", async () => {
    vi.useFakeTimers();
    const session = { token: "session-token", user: { id: "1", email: "test@example.com", displayName: "Test" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => session }));
    await expect(api.exchange("valid-code")).resolves.toEqual(session);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns native-style network failures into an actionable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
    await expect(api.logout("session-token")).rejects.toThrow("could not reach the server");
  });

  it("times out logout requests so callers are never blocked by the network", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const failure = expect(api.logout("session-token")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    await failure;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uploads recordings as multipart data without overriding the boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: "hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.transcribe(new Blob(["audio"], { type: "audio/webm" }), "recording.webm", "session-token")).resolves.toEqual({ text: "hello" });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(new Headers(request.headers).get("content-type")).toBeNull();
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get("file")).toBeInstanceOf(File);
    expect((request.body as FormData).get("file")).toHaveProperty("name", "recording.webm");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer session-token");
  });
});
