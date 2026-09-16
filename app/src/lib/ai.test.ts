import { afterEach, describe, expect, it, vi } from "vitest";
import { askAgent, buildSystemPrompt, getAgentSettings, parseAiResponse, saveAgentSettings } from "./ai";
import type { Habit, Task } from "../types";

describe("ai engine", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds a system prompt including active tasks", () => {
    const existing: Task[] = [
      {
        id: "1",
        title: "Test task",
        description: "",
        dueDate: null,
        priority: 2,
        completed: false,
        important: true,
        urgent: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      },
    ];
    const prompt = buildSystemPrompt(existing);
    expect(prompt).toContain("Test task");
    expect(prompt).toContain("Q1 Focus = important + urgent");
    expect(prompt).toContain("EISENHOWER CLASSIFICATION");
  });

  it("teaches the agent about real task, habit, and search capabilities", () => {
    const existingHabits: Habit[] = [{
      id: "habit-1",
      title: "Read for 20 minutes",
      important: true,
      urgent: false,
      interval: 1,
      unit: "day",
      startDate: "2026-09-16",
      completedDates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }];
    const prompt = buildSystemPrompt([], existingHabits);
    expect(prompt).toContain("create_task");
    expect(prompt).toContain("create_habit");
    expect(prompt).toContain("search_web");
    expect(prompt).toContain("Read for 20 minutes");
  });

  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      reply: "Here is your plan:",
      tasks: [
        {
          title: "Finish quarterly report",
          description: "Include the latest numbers",
          dueDate: "2026-09-16",
          priority: 1,
          important: true,
          urgent: true,
          reasoning: "Due today for executive meeting",
        },
        {
          title: "Read design book",
          important: true,
          urgent: false,
          reasoning: "Strategic long-term learning",
        },
      ],
    });

    const parsed = parseAiResponse(raw);
    expect(parsed.reply).toBe("Here is your plan:");
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0].title).toBe("Finish quarterly report");
    expect(parsed.tasks[0].description).toBe("Include the latest numbers");
    expect(parsed.tasks[0].dueDate).toBe("2026-09-16");
    expect(parsed.tasks[0].priority).toBe(1);
    expect(parsed.tasks[0].important).toBe(true);
    expect(parsed.tasks[0].urgent).toBe(true);
    expect(parsed.tasks[0].selected).toBe(true);
    expect(parsed.tasks[1].title).toBe("Read design book");
    expect(parsed.tasks[1].important).toBe(true);
    expect(parsed.tasks[1].urgent).toBe(false);
    expect(parsed.habits).toEqual([]);
  });

  it("parses recurring habits and clamps invalid intervals", () => {
    const parsed = parseAiResponse(JSON.stringify({
      reply: "Je t’ai préparé cette habitude.",
      habits: [{
        title: "Lire 20 minutes",
        important: true,
        urgent: false,
        interval: 999,
        unit: "week",
        reasoning: "Une pratique régulière aide à progresser.",
      }],
    }));
    expect(parsed.tasks).toEqual([]);
    expect(parsed.habits).toHaveLength(1);
    expect(parsed.habits[0]).toMatchObject({ title: "Lire 20 minutes", interval: 365, unit: "week", selected: true });
  });

  it("accepts tool-shaped create actions as a model fallback", () => {
    const parsed = parseAiResponse(JSON.stringify({
      reply: "Je t’ai préparé une habitude quotidienne.",
      actions: [{ tool: "create_habit", arguments: { title: "Boire de l’eau", interval: 1, unit: "day" } }],
    }));
    expect(parsed.habits[0]).toMatchObject({ title: "Boire de l’eau", interval: 1, unit: "day" });
  });

  it("accepts nested tool calls and recurring aliases", () => {
    const parsed = parseAiResponse(JSON.stringify({
      reply: "Prepared.",
      tool_calls: [{ function: { name: "create_habit", arguments: JSON.stringify({ title: "Walk", frequency: 2, period: "week" }) } }],
    }));
    expect(parsed.habits[0]).toMatchObject({ title: "Walk", interval: 2, unit: "week" });
  });

  it("extracts JSON enclosed in markdown code fences", () => {
    const raw = `Sure thing! Here is what you should do:
\`\`\`json
{
  "reply": "Organized into 1 task",
  "tasks": [
    {
      "title": "Send client contract",
      "important": true,
      "urgent": true,
      "reasoning": "Client waiting"
    }
  ]
}
\`\`\`
Hope this helps!`;

    const parsed = parseAiResponse(raw);
    expect(parsed.reply).toBe("Organized into 1 task");
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].title).toBe("Send client contract");
  });

  it("extracts JSON from fences without a language tag or with uppercase tags", () => {
    const untagged = parseAiResponse('```\n{"reply": "Hi", "tasks": []}\n```');
    expect(untagged.reply).toBe("Hi");
    const upper = parseAiResponse('```JSON\n{"reply": "Yo", "tasks": []}\n```');
    expect(upper.reply).toBe("Yo");
  });

  it("ignores non-object recurrence values when inferring habit units", () => {
    const parsed = parseAiResponse(JSON.stringify({
      reply: "Prepared.",
      habits: [{ title: "Stretch", recurrence: { interval: 2, unit: "week" } }],
    }));
    expect(parsed.habits[0]).toMatchObject({ title: "Stretch", interval: 2, unit: "week" });
    const fallback = parseAiResponse(JSON.stringify({
      reply: "Prepared.",
      habits: [{ title: "Read", unit: { nested: true } }],
    }));
    expect(fallback.habits[0]).toMatchObject({ title: "Read", unit: "day" });
  });

  it("handles conversational replies without tasks safely", () => {
    const raw = "Hello! How can I assist you with your priorities today?";
    const parsed = parseAiResponse(raw);
    expect(parsed.reply).toBe("Hello! How can I assist you with your priorities today?");
    expect(parsed.tasks).toEqual([]);
  });

  it("handles malformed JSON with fallback text", () => {
    const raw = "Not valid JSON at all";
    const parsed = parseAiResponse(raw);
    expect(parsed.reply).toBe("Not valid JSON at all");
    expect(parsed.tasks).toEqual([]);
  });

  it("reports a useful error when OpenRouter cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
    await expect(askAgent("Hello", [], [], [], { apiKey: "test-key", model: "openrouter/free", webSearch: false }))
      .rejects.toThrow("could not reach OpenRouter");
  });

  it("persists and retrieves agent settings", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, configurable: true });

    try {
      saveAgentSettings({ apiKey: "test-key-123", model: "meta-llama/llama-3.3-70b-instruct:free", webSearch: false });
      const loaded = getAgentSettings();
      expect(loaded.apiKey).toBe("test-key-123");
      expect(loaded.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
      expect(loaded.webSearch).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });
});
