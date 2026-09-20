// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentMutation, readAccountDocuments, reconcileDocuments, stageDocument, syncAccountDocuments, writeAccountDocuments, type AccountDocuments } from "./accountDocuments";
import { api } from "./api";
import { loadCalendarState, saveCalendarState, type CalendarState } from "./calendar";
import { memoryStorage } from "../test/memoryStorage";

vi.mock("./api", () => ({ api: { syncAccountData: vi.fn() } }));
const empty = (): AccountDocuments => ({ records: {}, pending: [] });
beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); vi.clearAllMocks(); localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" })); });

describe("account documents convergence", () => {
  it("merges independent fields and keeps edits made during an upload", () => {
    const docs = empty();
    stageDocument(docs, "calendar/event/a/e", { title: "Course", color: "blue" });
    const sent = docs.pending[0].id;
    stageDocument(docs, "calendar/event/a/e", { title: "Renamed offline", color: "blue" });
    const merged = reconcileDocuments(docs, [{ key: "calendar/event/a/e", value: { title: "Course", color: "green" } }], [sent]);
    expect(merged.records["calendar/event/a/e"]).toEqual({ title: "Renamed offline", color: "green" });
    expect(merged.pending).toHaveLength(1);
    expect(merged.pending[0].patch).toEqual({ title: "Renamed offline" });
  });
  it("never resurrects deleted events from offline edits or migration seeds", () => {
    const docs = empty();
    stageDocument(docs, "calendar/event/a/e", { title: "Course" });
    const merged = reconcileDocuments(docs, [{ key: "calendar/event/a/e", value: null }], []);
    expect(merged.records["calendar/event/a/e"]).toBeNull();
    applyDocumentMutation(merged.records, { id: "seed", key: "calendar/event/a/e", patch: { title: "Old" }, seed: true });
    expect(merged.records["calendar/event/a/e"]).toBeNull();
  });
  it("retains pending changes after network failures and retries them unchanged", async () => {
    const docs = empty(); stageDocument(docs, "preferences/ui", { language: "fr" }); writeAccountDocuments(docs);
    vi.mocked(api.syncAccountData).mockRejectedValueOnce(new Error("offline"));
    await expect(syncAccountDocuments("token", () => true)).rejects.toThrow("offline");
    expect(readAccountDocuments().pending).toEqual(docs.pending);
    vi.mocked(api.syncAccountData).mockResolvedValueOnce({ records: [{ key: "preferences/ui", value: { language: "fr" } }], applied: docs.pending.map((m) => m.id) });
    await syncAccountDocuments("token", () => true);
    expect(readAccountDocuments().pending).toHaveLength(0);
  });
  it("does not write an old account response into a newly selected account", async () => {
    vi.mocked(api.syncAccountData).mockImplementationOnce(async () => {
      localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
      return { records: [{ key: "preferences/ui", value: { private: "A" } }], applied: [] };
    });
    await syncAccountDocuments("token", () => true);
    expect(readAccountDocuments().records).toEqual({});
  });
  it("pulls remote data even with an empty outbox", async () => {
    vi.mocked(api.syncAccountData).mockResolvedValueOnce({ records: [{ key: "preferences/ui", value: { language: "fr" } }], applied: [] });
    await syncAccountDocuments("token", () => true);
    expect(readAccountDocuments().records["preferences/ui"]).toEqual({ language: "fr" });
  });
});

describe("calendar sync persistence", () => {
  const calendar = (): CalendarState => ({ showHabits: true, sources: [{ id: "iut", type: "ics", name: "IUT", url: "https://example.com/course.ics", enabled: true, color: "blue", events: [], hiddenTitles: ["SAE"], eventOverrides: { lesson: { hidden: true, locked: true, color: "red" } }, refreshInterval: "hourly" }] });
  it("migrates once and keeps provider caches out of the sync outbox", () => {
    const state = calendar(); saveCalendarState(state);
    const docs = readAccountDocuments();
    docs.pending = []; writeAccountDocuments(docs, false);
    saveCalendarState({ ...loadCalendarState(), sources: [{ ...loadCalendarState().sources[0], lastSyncedAt: new Date().toISOString(), icsData: "provider raw data" }] });
    expect(readAccountDocuments().pending).toHaveLength(0);
    expect(JSON.stringify(readAccountDocuments().records)).not.toContain("provider raw data");
    expect(loadCalendarState().sources[0].icsData).toBe("provider raw data");
  });
  it("allows removing and re-adding the same filtering rule and event preferences", () => {
    saveCalendarState(calendar());
    const restored = loadCalendarState(); restored.sources[0].hiddenTitles = []; restored.sources[0].eventOverrides = {};
    saveCalendarState(restored);
    expect(loadCalendarState().sources[0].hiddenTitles).toEqual([]);
    saveCalendarState(calendar());
    expect(loadCalendarState().sources[0].hiddenTitles).toEqual(["SAE"]);
    expect(loadCalendarState().sources[0].eventOverrides?.lesson).toEqual({ hidden: true, locked: true, color: "red" });
  });
  it("synchronizes file ICS contents and personal recurring events", () => {
    const state = calendar(); state.sources[0].url = ""; state.sources[0].icsData = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
    saveCalendarState(state);
    const docs = readAccountDocuments();
    expect(docs.records["calendar/source/iut"]?.icsData).toContain("BEGIN:VCALENDAR");
    expect(docs.records["calendar/source/iut"]?.events).toBeUndefined();
  });
});
