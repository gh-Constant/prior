import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailProvider } from "./mail";

function b64(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const FULL_MESSAGE = {
  id: "msg1",
  threadId: "thread1",
  labelIds: ["INBOX"],
  snippet: "Hello world snippet",
  internalDate: "1726656000000",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Alice <alice@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Hello" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: b64("Hello world body") } },
      { mimeType: "text/html", body: { data: b64("<p>Hello world body</p>") } },
    ],
  },
};

describe("GmailProvider.modify", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the full message, not the sparse modify echo", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        seen.push(url);
        const data = url.includes("/modify")
          // The real modify endpoint echoes ids/labels only, no payload.
          ? { id: "msg1", threadId: "thread1", labelIds: ["INBOX"] }
          : FULL_MESSAGE;
        return { ok: true, status: 200, json: async () => data };
      }),
    );
    const provider = new GmailProvider("me@example.com", async () => "token");
    const updated = await provider.modify("msg1", [], ["UNREAD"]);
    expect(seen.some((u) => u.includes("/modify"))).toBe(true);
    expect(seen.some((u) => u.includes("/messages/msg1?format=full"))).toBe(true);
    expect(updated.subject).toBe("Hello");
    expect(updated.from.email).toBe("alice@example.com");
    expect(updated.body).toContain("Hello world body");
    expect(updated.bodyHtml).toContain("<p>Hello world body</p>");
    expect(updated.unread).toBe(false);
  });
});
