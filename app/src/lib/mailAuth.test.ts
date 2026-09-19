import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMailAccount, emitMailAccountChange, getMailAccount, MAIL_ACCOUNT_EVENT, saveMailAccount } from "./mailAuth";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

describe("mail account change event", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: makeStorage() });
  });
  it("notifies listeners so native views refresh without a reload", () => {
    const listener = vi.fn();
    window.addEventListener(MAIL_ACCOUNT_EVENT, listener);
    try {
      emitMailAccountChange();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MAIL_ACCOUNT_EVENT, listener);
    }
  });

  it("round-trips the local mail account record", () => {
    saveMailAccount({ email: "me@example.com", connectedAt: new Date().toISOString() });
    expect(getMailAccount()?.email).toBe("me@example.com");
    clearMailAccount();
    expect(getMailAccount()).toBeNull();
  });
});
