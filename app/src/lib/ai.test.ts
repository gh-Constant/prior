import { describe, expect, it } from "vitest";
import { buildSystemPrompt, getAgentSettings, parseAiResponse, saveAgentSettings } from "./ai";
import type { Task } from "../types";

describe("ai engine", () => {
  it("builds a system prompt including active tasks", () => {
    const existing: Task[] = [
      {
        id: "1",
        title: "Test task",
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
    expect(prompt).toContain("Quadrant 1 (Focus / Do First)");
    expect(prompt).toContain("Eisenhower Matrix Guidelines");
  });

  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      reply: "Here is your plan:",
      tasks: [
        {
          title: "Finish quarterly report",
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
    expect(parsed.tasks[0].important).toBe(true);
    expect(parsed.tasks[0].urgent).toBe(true);
    expect(parsed.tasks[0].selected).toBe(true);
    expect(parsed.tasks[1].title).toBe("Read design book");
    expect(parsed.tasks[1].important).toBe(true);
    expect(parsed.tasks[1].urgent).toBe(false);
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
      saveAgentSettings({ apiKey: "test-key-123", model: "meta-llama/llama-3.3-70b-instruct:free" });
      const loaded = getAgentSettings();
      expect(loaded.apiKey).toBe("test-key-123");
      expect(loaded.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });
});
