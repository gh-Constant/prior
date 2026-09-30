import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLocalExport, wipeAccountLocalData } from "./accountData";
import { localStore } from "./localStore";

describe("account data on the device", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("wipes only the deleted account's scoped data and private device state", async () => {
    localStorage.setItem("prior.tasks.v1.account.v2.u1", "[1]");
    localStorage.setItem("prior.game.state.v1.account.v2.u1", "{}");
    localStorage.setItem("prior.tasks.v1.account.v2.u2", "[2]");
    localStorage.setItem("prior.notes.tabs", "[\"n1\"]");
    localStorage.setItem("prior.theme", "dark");
    const wipe = vi.spyOn(localStore, "wipeAccount");

    await wipeAccountLocalData("u1");

    expect(wipe).toHaveBeenCalledWith("u1");
    expect(localStorage.getItem("prior.tasks.v1.account.v2.u1")).toBeNull();
    expect(localStorage.getItem("prior.game.state.v1.account.v2.u1")).toBeNull();
    expect(localStorage.getItem("prior.notes.tabs")).toBeNull();
    expect(localStorage.getItem("prior.tasks.v1.account.v2.u2")).toBe("[2]");
    expect(localStorage.getItem("prior.theme")).toBe("dark");
  });

  it("exports local tasks without deleted ones", async () => {
    await localStore.saveTask({ title: "Keep me", important: true, urgent: false });
    const removed = await localStore.saveTask({ title: "Gone", important: false, urgent: false });
    await localStore.removeTask(removed);
    const data = await buildLocalExport(new Date("2026-09-30T08:00:00Z"));
    expect(data.format).toBe("prior-local-export");
    expect(data.exportedAt).toBe("2026-09-30T08:00:00.000Z");
    expect(data.tasks.map((task) => (task as { title: string }).title)).toEqual(["Keep me"]);
  });
});
