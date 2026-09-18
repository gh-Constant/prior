import { describe, expect, it } from "vitest";
import { normalizeProjectPlanning, withProjectPlanning } from "./projectPlanning";
import type { Project } from "../types";

describe("projectPlanning", () => {
  it("normalizes valid health and date strings", () => {
    const result = normalizeProjectPlanning({
      health: "On track",
      startDate: "2026-09-01",
      targetDate: "2026-09-30",
    });
    expect(result.health).toBe("On track");
    expect(result.startDate).toBe("2026-09-01");
    expect(result.targetDate).toBe("2026-09-30");
    expect(result.cycles).toEqual([]);
  });

  it("filters out invalid health values and malformed dates", () => {
    const result = normalizeProjectPlanning({
      health: "invalid" as any,
      startDate: "09/01/2026",
      targetDate: "not-a-date",
    });
    expect(result.health).toBeNull();
    expect(result.startDate).toBeNull();
    expect(result.targetDate).toBeNull();
  });

  it("sanitizes cycles, drops invalid entries, and deduplicates issue IDs", () => {
    const result = normalizeProjectPlanning({
      cycles: [
        {
          id: " c1 ",
          name: "Sprint 1",
          startsOn: "2026-09-01",
          endsOn: "2026-09-14",
          issueIds: ["task-1", "task-2", "task-1", "  task-3  "],
        },
        {
          id: "",
          name: "Invalid missing ID",
          startsOn: "2026-09-01",
          endsOn: "2026-09-14",
        } as any,
      ],
    });
    expect(result.cycles).toEqual([
      {
        id: "c1",
        name: "Sprint 1",
        startsOn: "2026-09-01",
        endsOn: "2026-09-14",
        issueIds: ["task-1", "task-2", "task-3"],
      },
    ]);
  });

  it("merges planning fields onto an existing project", () => {
    const base: Project = {
      id: "p1",
      areaId: null,
      name: "Project",
      description: "",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    };
    const updated = withProjectPlanning(base, { health: "At risk", startDate: "2026-10-01" });
    expect(updated.health).toBe("At risk");
    expect(updated.startDate).toBe("2026-10-01");
    expect(updated.name).toBe("Project");
  });
});
