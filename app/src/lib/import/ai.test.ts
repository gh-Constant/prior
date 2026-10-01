import { beforeEach, describe, expect, it, vi } from "vitest";

const agentComplete = vi.fn();
const hostedAiStatus = vi.fn();
const getToken = vi.fn();

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, agentComplete: (...args: unknown[]) => agentComplete(...args), hostedAiStatus: (...args: unknown[]) => hostedAiStatus(...args) } };
});
vi.mock("../auth", () => ({ getToken: () => getToken() }));

import { ApiCodeError } from "../api";
import { FIXTURES, TODAY } from "./__fixtures__";
import { analyzeFile } from "./analyze";
import { AI_CHUNK_CHARS, AI_MAX_REQUESTS, applyCleanup, chunkLines, loadAiAccess, organiseWithAi, parseJsonObject, tasksFromExtraction } from "./ai";
import { makeTask } from "./types";

const answer = (value: unknown) => ({ content: JSON.stringify(value), actualModel: "test/model", provider: "hosted" });
const settings = { today: TODAY };

beforeEach(() => {
  agentComplete.mockReset();
  hostedAiStatus.mockReset();
  getToken.mockReset();
  getToken.mockResolvedValue("session-token");
});

describe("loadAiAccess", () => {
  it("hides AI when signed out, locks it without a plan, and enables it with one", async () => {
    getToken.mockResolvedValueOnce(null);
    expect(await loadAiAccess()).toBe("signed-out");
    hostedAiStatus.mockResolvedValueOnce({ available: false, entitlement: { allowed: false, plan: "free" } });
    expect(await loadAiAccess()).toBe("locked");
    hostedAiStatus.mockResolvedValueOnce({ available: true, entitlement: { allowed: true, plan: "pro" } });
    expect(await loadAiAccess()).toBe("ready");
    hostedAiStatus.mockResolvedValueOnce({ available: false, entitlement: { allowed: true, plan: "pro" } });
    expect(await loadAiAccess()).toBe("unavailable");
    hostedAiStatus.mockRejectedValueOnce(new Error("offline"));
    expect(await loadAiAccess()).toBe("unavailable");
  });
});

describe("validating the model's answers", () => {
  it("finds JSON in a noisy answer", () => {
    expect(parseJsonObject('Sure! {"tasks":[]} done')).toEqual({ tasks: [] });
    expect(parseJsonObject("no json")).toBeNull();
    expect(parseJsonObject("[1,2]")).toBeNull();
  });

  it("cleans up tasks without losing data and clamps every field", () => {
    const tasks = [
      makeTask("a", "Call mum — about the birthday", { description: "Labels: family", priority: 4 }),
      makeTask("b", "Pay rent", { dueDate: "2026-10-05", priority: 2, projectName: "Home" }),
    ];
    const changed = applyCleanup(tasks, {
      tasks: [
        { i: 0, title: "Call mum", extra: "About the birthday", dueDate: "2026-13-45", priority: 1, important: true, urgent: false, project: "Family", repeats: "every sunday" },
        { i: 1, title: "", extra: "", dueDate: "2027-01-01", priority: 9, project: "Other", repeats: null },
        { i: 7, title: "Ghost" },
        "junk",
      ],
    });
    expect(changed).toBe(1);
    expect(tasks[0]).toMatchObject({ title: "Call mum", priority: 1, important: true, urgent: false, dueDate: null, projectName: "Family" });
    expect(tasks[0].description).toBe("About the birthday\n\nLabels: family\n\nRepeats: every sunday");
    // Existing due date, priority and project are never overwritten.
    expect(tasks[1]).toMatchObject({ title: "Pay rent", dueDate: "2026-10-05", priority: 2, projectName: "Home" });
  });

  it("builds tasks from an extraction, keeping only real, earlier parents in the same project", () => {
    const tasks = tasksFromExtraction({
      tasks: [
        { title: "Plan trip", priority: 2, dueDate: "2026-11-01", project: "Travel" },
        { title: "Book flights", parent: 0, project: "Travel", done: true },
        { title: "Pack", parent: 0, project: "Elsewhere" },
        { title: "Self parent", parent: 3 },
        { title: "x".repeat(500), priority: 7 },
        { title: "   " },
        { notATask: true },
      ],
    }, "ai1:1");
    expect(tasks.map((task) => task.title.length > 100 ? "long" : task.title)).toEqual(["Plan trip", "Book flights", "Pack", "Self parent", "long"]);
    expect(tasks[0]).toMatchObject({ priority: 2, important: true, dueDate: "2026-11-01", projectName: "Travel" });
    expect(tasks[1]).toMatchObject({ parentKey: tasks[0].key, state: "completed", status: "done" });
    expect(tasks[2].parentKey).toBeNull();
    expect(tasks[3].parentKey).toBeNull();
    expect(tasks[4].title).toHaveLength(200);
    expect(tasks[4].priority).toBe(4);
    expect(new Set(tasks.map((task) => task.key)).size).toBe(tasks.length);
  });

  it("chunks lines under the limit, repeating room for a header", () => {
    expect(chunkLines(["aaaa", "bbbb", "cccc"], 10)).toEqual([["aaaa", "bbbb"], ["cccc"]]);
    expect(chunkLines(["x".repeat(30)], 10)).toEqual([["x".repeat(10)]]);
    expect(chunkLines([])).toEqual([]);
  });
});

describe("organiseWithAi", () => {
  it("reads pasted text with the model through the hosted import purpose", async () => {
    agentComplete.mockResolvedValueOnce(answer({ tasks: [{ title: "Buy milk", priority: 3, dueDate: "2026-10-02", project: null, parent: null, done: false }, { title: "Whole milk", parent: 0 }] }));
    const progress: Array<[number, number]> = [];
    const result = await organiseWithAi({ files: [analyzeFile({ name: "pasted", text: "need milk tmrw, whole" })], settings, existingProjects: ["Home"], onProgress: (p) => progress.push([p.done, p.total]) });
    expect(result.stopped).toBeNull();
    expect(result.batch.source).toBe("text");
    expect(result.batch.tasks.map((task) => task.title)).toEqual(["Buy milk", "Whole milk"]);
    expect(result.batch.tasks[1].parentKey).toBe(result.batch.tasks[0].key);
    expect(progress).toEqual([[0, 1], [1, 1]]);
    const [request, token] = agentComplete.mock.calls[0];
    expect(token).toBe("session-token");
    expect(request).toMatchObject({ purpose: "import", provider: "hosted", json: true, model: "", webSearch: false });
    expect(request.system).toContain("Today is 2026-10-01");
    expect(request.system).toContain('"Home"');
    expect(request.prompt).toBe("need milk tmrw, whole");
  });

  it("cleans up a known export and keeps its projects, areas and hierarchy", async () => {
    agentComplete.mockImplementationOnce(async (request: { prompt: string }) => {
      const rows = request.prompt.split("\n").map((line) => JSON.parse(line) as { i: number; t: string; proj: string | null });
      expect(rows.length).toBe(6);
      const flaky = rows.find((row) => row.t === "Investigate flaky test");
      expect(flaky?.proj).toBe("Engineering");
      return answer({ tasks: rows.map((row) => ({ i: row.i, title: row.t, extra: "", dueDate: null, priority: 4, important: false, urgent: false, project: null, repeats: null })) });
    });
    const result = await organiseWithAi({ files: [analyzeFile(FIXTURES.linear)], settings, existingProjects: [] });
    expect(result.batch.source).toBe("linear");
    expect(result.batch.tasks).toHaveLength(6);
    expect(result.batch.projects.find((project) => project.name === "Platform")).toMatchObject({ projectType: "software", areaName: "Engineering" });
    expect(result.batch.tasks.find((task) => task.title === "Cache the Docker layers")?.parentKey).toBe("ENG-1");
    expect(agentComplete).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain reader when a request fails or answers garbage", async () => {
    agentComplete.mockResolvedValueOnce({ content: "I cannot do that", actualModel: "x" });
    const result = await organiseWithAi({ files: [analyzeFile({ name: "pasted", text: "- Buy milk\n- Call mum" })], settings, existingProjects: [] });
    expect(result.stopped).toBeNull();
    expect(result.batch.tasks.map((task) => task.title)).toEqual(["Buy milk", "Call mum"]);
    expect(result.warnings).toContainEqual({ code: "aiPartial" });
  });

  it("stops asking after a plan refusal and keeps the plain result", async () => {
    agentComplete.mockRejectedValueOnce(new ApiCodeError("Prior AI is included in paid plans", "HOSTED_AI_REQUIRES_PLAN", 402));
    const files = [analyzeFile({ name: "a.txt", text: "- One" }), analyzeFile({ name: "b.txt", text: "- Two" }), analyzeFile(FIXTURES.linear)];
    const result = await organiseWithAi({ files, settings, existingProjects: [] });
    expect(result.stopped).toBe("plan");
    expect(agentComplete).toHaveBeenCalledTimes(1);
    expect(result.batch.tasks.map((task) => task.title)).toEqual(expect.arrayContaining(["One", "Two", "Set up the CI pipeline"]));
  });

  it("never sends more than the request budget, and cuts big files into chunks", async () => {
    const lines = Array.from({ length: 4000 }, (_, index) => `- Task number ${index} with a reasonably long description to fill the chunk`);
    agentComplete.mockImplementation(async () => answer({ tasks: [{ title: "T" }] }));
    const big = await organiseWithAi({ files: [analyzeFile({ name: "pasted", text: lines.join("\n") })], settings, existingProjects: [] });
    // Too long for ten requests: read without AI, nothing sent.
    expect(agentComplete).not.toHaveBeenCalled();
    expect(big.batch.tasks).toHaveLength(4000);
    expect(big.warnings).toContainEqual({ code: "aiTooLong", file: "pasted" });

    const medium = lines.slice(0, 600).join("\n");
    expect(medium.length).toBeGreaterThan(AI_CHUNK_CHARS);
    const result = await organiseWithAi({ files: [analyzeFile({ name: "pasted", text: medium })], settings, existingProjects: [] });
    expect(agentComplete.mock.calls.length).toBeGreaterThan(1);
    expect(agentComplete.mock.calls.length).toBeLessThanOrEqual(AI_MAX_REQUESTS);
    for (const [request] of agentComplete.mock.calls) expect(request.prompt.length).toBeLessThanOrEqual(AI_CHUNK_CHARS);
    expect(result.batch.tasks.length).toBe(agentComplete.mock.calls.length);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(organiseWithAi({ files: [analyzeFile({ name: "pasted", text: "- One" })], settings, existingProjects: [], signal: controller.signal })).rejects.toThrow(/cancelled/);
  });

  it("needs a session", async () => {
    getToken.mockResolvedValue(null);
    await expect(organiseWithAi({ files: [analyzeFile({ name: "pasted", text: "- One" })], settings, existingProjects: [] })).rejects.toThrow(/Sign in/);
  });
});
