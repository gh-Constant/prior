import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { defaultTaskFilters, filterTasks } from "./taskFilters";
import type { ProjectIssue } from "../components/collaboration/types";
import { isIssueVisibleToUser, isProjectTaskAssigned, mergeAssignedProjectTasks } from "./projectTasks";

const reference = new Date("2026-09-15T12:00:00.000Z");

function makeTask(id: string, options: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    dueDate: null,
    priority: 4,
    completed: false,
    important: false,
    urgent: false,
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
    deletedAt: null,
    ...options,
  };
}

function makeIssue(id: string, options: Partial<ProjectIssue> = {}): ProjectIssue {
  return { id, title: `Issue ${id}`, stateId: "next", people: [], ...options };
}

describe("isIssueVisibleToUser", () => {
  it("treats owner, assignee and collaborator membership as assigned", () => {
    for (const role of ["owner", "assignee", "collaborator"] as const) {
      expect(isIssueVisibleToUser(makeIssue("a", { people: [{ id: "me", name: "Me", role }] }), "me")).toBe(true);
    }
  });

  it("hides issues assigned only to someone else", () => {
    expect(isIssueVisibleToUser(makeIssue("a", { people: [{ id: "sam", name: "Sam", role: "owner" }] }), "me")).toBe(false);
  });

  it("keeps unassigned issues visible and shows everything without a user", () => {
    expect(isIssueVisibleToUser(makeIssue("a"), "me")).toBe(true);
    expect(isIssueVisibleToUser(makeIssue("a", { people: [{ id: "sam", name: "Sam", role: "owner" }] }), null)).toBe(true);
  });
});

describe("isProjectTaskAssigned", () => {
  it("matches peopleIds and ignores personal tasks", () => {
    expect(isProjectTaskAssigned(makeTask("a", { projectId: "p1", peopleIds: ["me"] }), "me")).toBe(true);
    expect(isProjectTaskAssigned(makeTask("a", { projectId: "p1", peopleIds: ["sam"] }), "me")).toBe(false);
    expect(isProjectTaskAssigned(makeTask("a", { peopleIds: ["me"] }), "me")).toBe(false);
    expect(isProjectTaskAssigned(makeTask("a", { projectId: "p1" }), "me")).toBe(true);
  });
});

describe("mergeAssignedProjectTasks", () => {
  it("dedupes against existing tasks and keeps the local row", () => {
    const local = makeTask("one", { title: "Local title", projectId: "p1", peopleIds: ["me"] });
    const merged = mergeAssignedProjectTasks([local], {
      p1: { issues: [makeIssue("one", { title: "Server title", people: [{ id: "me", name: "Me", role: "owner" }] })] },
    }, "me");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("Local title");
  });

  it("adds missing assigned issues as project tasks without touching inbox/waiting rows", () => {
    const personal = makeTask("inbox-1", { status: "inbox" });
    const merged = mergeAssignedProjectTasks([personal], {
      p1: {
        issues: [
          makeIssue("mine", { title: "My project work", stateId: "next", priority: 1, people: [{ id: "me", name: "Me", role: "assignee" }] }),
          makeIssue("theirs", { title: "Sam work", stateId: "next", people: [{ id: "sam", name: "Sam", role: "owner" }] }),
        ],
      },
    }, "me");
    expect(merged.map((task) => task.id).sort()).toEqual(["inbox-1", "mine"]);
    const added = merged.find((task) => task.id === "mine");
    expect(added?.projectId).toBe("p1");
    expect(added?.status).toBe("next");
    expect(added?.priority).toBe(1);
  });

  it("defaults unknown workflow states to next so inbox and waiting stay untouched", () => {
    const merged = mergeAssignedProjectTasks([], {
      p1: { issues: [makeIssue("x", { stateId: "missing", people: [{ id: "me", name: "Me", role: "owner" }] })] },
    }, "me");
    expect(merged[0]?.status).toBe("next");
    expect(merged[0]?.completed).toBe(false);
  });

  it("marks done/category-completed issues completed so the open filter hides them", () => {
    const merged = mergeAssignedProjectTasks([], {
      p1: {
        states: [{ id: "shipped", name: "Shipped", category: "completed" }],
        issues: [
          makeIssue("d1", { stateId: "done", people: [{ id: "me", name: "Me", role: "owner" }] }),
          makeIssue("d2", { stateId: "shipped", people: [{ id: "me", name: "Me", role: "owner" }] }),
        ],
      },
    }, "me");
    expect(merged.filter((task) => task.completed).map((task) => task.id).sort()).toEqual(["d1", "d2"]);
    expect(filterTasks(merged, defaultTaskFilters, reference)).toHaveLength(0);
    expect(filterTasks(merged, { ...defaultTaskFilters, status: "completed" }, reference)).toHaveLength(2);
  });

  it("returns the input array when there is nothing to merge", () => {
    const tasks = [makeTask("a")];
    expect(mergeAssignedProjectTasks(tasks, undefined, "me")).toBe(tasks);
    expect(mergeAssignedProjectTasks(tasks, { p1: { issues: [] } }, "me")).toBe(tasks);
  });
});
