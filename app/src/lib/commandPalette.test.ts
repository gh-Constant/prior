import { beforeEach, describe, expect, it } from "vitest";
import { readRecent, rememberRecent, searchPalette, taskItems, type PaletteItem } from "./commandPalette";

const items: PaletteItem[] = [
  { key: "command:new-task", kind: "command", id: "new-task", label: "New task" },
  { key: "command:theme-dark", kind: "command", id: "theme-dark", label: "Use the dark theme", keywords: "appearance" },
  ...taskItems([
    { id: "t1", title: "Pay taxes", description: "before Friday", dueDate: null, priority: 4, completed: false, important: true, urgent: true, createdAt: "", updatedAt: "", deletedAt: null, checklist: [{ id: "c1", title: "Find receipts", done: false, position: 0 }] },
    { id: "t2", title: "Pay rent", description: "", dueDate: null, priority: 4, completed: true, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null },
    { id: "t3", title: "Deleted", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: "2026-01-01" },
  ]),
  { key: "note:n1", kind: "note", id: "n1", label: "Tax notes", keywords: "deductions" },
  { key: "project:p1", kind: "project", id: "p1", label: "Taxes 2026" },
];

describe("command palette search", () => {
  beforeEach(() => localStorage.clear());

  it("shows recent items then commands without a query", () => {
    const groups = searchPalette("", items, ["task:t1", "missing"]);
    expect(groups.map((group) => group.kind)).toEqual(["recent", "command"]);
    expect(groups[0].items.map((item) => item.key)).toEqual(["task:t1"]);
  });

  it("groups fuzzy matches by kind and searches descriptions and checklists", () => {
    const groups = searchPalette("tax", items);
    expect(groups.map((group) => group.kind)).toEqual(["task", "note", "project"]);
    expect(searchPalette("receipts", items)[0].items[0].id).toBe("t1");
    expect(searchPalette("appearance", items)[0].items[0].id).toBe("theme-dark");
    expect(searchPalette("deleted", items)).toEqual([]);
  });

  it("puts open tasks before completed ones and recent matches first", () => {
    const tasks = searchPalette("pay", items).find((group) => group.kind === "task")!;
    expect(tasks.items.map((item) => item.id)).toEqual(["t1", "t2"]);
    const withRecent = searchPalette("pay", items, ["task:t2"]);
    expect(withRecent[0]).toEqual({ kind: "recent", items: [expect.objectContaining({ id: "t2" })] });
    expect(withRecent[1].items.map((item) => item.id)).toEqual(["t1"]);
  });

  it("remembers recent picks, newest first, without duplicates", () => {
    rememberRecent("task:t1");
    rememberRecent("note:n1");
    rememberRecent("task:t1");
    expect(readRecent()).toEqual(["task:t1", "note:n1"]);
  });
});
