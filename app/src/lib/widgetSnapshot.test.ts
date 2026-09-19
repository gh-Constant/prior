import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { buildWidgetSnapshot, parseWidgetUrl } from "./widgetSnapshot";

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: "",
    dueDate: null,
    priority: 4,
    completed: false,
    important: false,
    urgent: false,
    createdAt: "2026-09-19T08:00:00.000Z",
    updatedAt: "2026-09-19T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-19T10:00:00.000Z");

describe("buildWidgetSnapshot", () => {
  it("selects today tasks and counts matrix quadrants", () => {
    const tasks = [
      task({ id: "1", title: "Due today", dueDate: "2026-09-19", status: "next", important: true, urgent: true }),
      task({ id: "2", title: "Overdue", dueDate: "2026-09-10", status: "next" }),
      task({ id: "3", title: "Future", dueDate: "2026-09-30", status: "next", important: true }),
      task({ id: "4", title: "Inbox item", status: "inbox" }),
      task({ id: "5", title: "Done today", completed: true, updatedAt: "2026-09-19T09:00:00.000Z" }),
      task({ id: "6", title: "Waiting", status: "waiting", dueDate: "2026-09-19" }),
    ];
    const snapshot = buildWidgetSnapshot(tasks, NOW);
    expect(snapshot.version).toBe(1);
    expect(snapshot.today.open).toBe(2);
    expect(snapshot.today.done).toBe(1);
    expect(snapshot.today.items.map((i) => i.id)).toEqual(["2", "1"]);
    expect(snapshot.inbox.total).toBe(1);
    expect(snapshot.matrix).toEqual({ focus: 1, plan: 1, quick: 0, later: 2 });
    expect(snapshot.calendar.items.length).toBeGreaterThan(0);
  });

  it("caps items and skips deleted tasks", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task({ id: `t${i}`, title: `Task ${i}`, status: "inbox" }),
    );
    tasks.push(task({ id: "gone", title: "Gone", status: "inbox", deletedAt: "2026-09-19T09:00:00.000Z" }));
    const snapshot = buildWidgetSnapshot(tasks, NOW);
    expect(snapshot.inbox.total).toBe(12);
    expect(snapshot.inbox.items).toHaveLength(8);
  });
});

describe("parseWidgetUrl", () => {
  it("accepts prior://widget/<view> links", () => {
    expect(parseWidgetUrl("prior://widget/today")).toBe("today");
    expect(parseWidgetUrl("prior://widget/inbox")).toBe("inbox");
    expect(parseWidgetUrl("prior://widget/calendar")).toBe("calendar");
    expect(parseWidgetUrl("prior://widget/eisenhower")).toBe("eisenhower");
    expect(parseWidgetUrl("prior://auth/callback?code=x")).toBeNull();
    expect(parseWidgetUrl("https://example.com")).toBeNull();
    expect(parseWidgetUrl("not a url")).toBeNull();
  });
});
