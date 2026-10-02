import { describe, expect, it } from "vitest";
import { PROJECT_KINDS, agileFeatures, applyProjectKind, filterBySprint, projectKindOf, projectMethodology, sprintStats, sumStoryPoints, taskBadgeKind, velocity } from "./agile";

describe("methodology", () => {
  it("defaults agile projects to kanban and standard ones to none", () => {
    expect(projectMethodology({ projectType: "software" })).toBe("kanban");
    expect(projectMethodology({ projectType: "software", methodology: "scrum" })).toBe("scrum");
    expect(projectMethodology({ projectType: "software", methodology: "nonsense" as never })).toBe("kanban");
    expect(projectMethodology({ projectType: "standard", methodology: "scrum" })).toBeNull();
    expect(projectMethodology({})).toBeNull();
    expect(projectMethodology(null)).toBeNull();
  });

  it("turns features on per methodology and none for standard or kanban", () => {
    expect(agileFeatures({ projectType: "software", methodology: "scrum" })).toEqual({ points: true, sprints: true, poker: true });
    expect(agileFeatures({ projectType: "software", methodology: "scrumban" })).toEqual({ points: true, sprints: false, poker: true });
    expect(agileFeatures({ projectType: "software", methodology: "kanban" })).toEqual({ points: false, sprints: false, poker: false });
    expect(agileFeatures({ projectType: "software" })).toEqual({ points: false, sprints: false, poker: false });
    // A methodology left over on a standard project does nothing.
    expect(agileFeatures({ projectType: "standard", methodology: "scrum" })).toEqual({ points: false, sprints: false, poker: false });
  });

  it("shows story points instead of priority only when points are on", () => {
    expect(taskBadgeKind({ projectType: "software", methodology: "scrum" })).toBe("points");
    expect(taskBadgeKind({ projectType: "software", methodology: "scrumban" })).toBe("points");
    expect(taskBadgeKind({ projectType: "software", methodology: "kanban" })).toBe("priority");
    expect(taskBadgeKind({ projectType: "standard" })).toBe("priority");
    expect(taskBadgeKind(null)).toBe("priority");
  });
});

describe("project kind", () => {
  it("maps projects to the four picker choices", () => {
    expect(PROJECT_KINDS).toEqual(["standard", "kanban", "scrum", "scrumban"]);
    expect(projectKindOf({ projectType: "standard" })).toBe("standard");
    expect(projectKindOf({ projectType: "software" })).toBe("kanban");
    expect(projectKindOf({ projectType: "software", methodology: "scrumban" })).toBe("scrumban");
  });

  it("applies a choice without ever writing a null methodology", () => {
    const scrum = applyProjectKind({ name: "x", projectType: "standard" as const }, "scrum");
    expect(scrum).toMatchObject({ projectType: "software", methodology: "scrum" });
    const back = applyProjectKind(scrum, "standard");
    expect(back.projectType).toBe("standard");
    expect(back.methodology).toBe("scrum");
    expect(applyProjectKind(back, "kanban")).toMatchObject({ projectType: "software", methodology: "kanban" });
  });
});

const issues = [
  { id: "a", storyPoints: 3, done: true },
  { id: "b", storyPoints: 5, done: false },
  { id: "c", storyPoints: null, done: true },
  { id: "d", storyPoints: 8, done: true },
  { id: "e", storyPoints: 2, done: true },
  { id: "f", done: false },
];

describe("sprint maths", () => {
  it("sums only estimated issues", () => {
    expect(sumStoryPoints([{ storyPoints: 1.5 }, { storyPoints: null }, {}, { storyPoints: 3 }])).toBe(4.5);
  });

  it("counts committed and done points of a sprint", () => {
    expect(sprintStats({ issueIds: ["a", "b", "c", "zzz"] }, issues)).toEqual({ issues: 3, doneIssues: 2, committed: 8, done: 3, unestimated: 1 });
    expect(sprintStats({}, issues)).toEqual({ issues: 0, doneIssues: 0, committed: 0, done: 0, unestimated: 0 });
  });

  it("averages the last three finished sprints with work", () => {
    const cycles = [
      { startsOn: "2026-01-01", endsOn: "2026-01-14", issueIds: ["a"] }, // 3 done, oldest: left out
      { startsOn: "2026-01-15", endsOn: "2026-01-28", issueIds: ["d"] }, // 8
      { startsOn: "2026-01-29", endsOn: "2026-02-11", issueIds: ["e", "b"] }, // 2
      { startsOn: "2026-02-12", endsOn: "2026-02-25", issueIds: ["a", "d"] }, // 11
      { startsOn: "2026-02-26", endsOn: "2026-03-10", issueIds: [] }, // empty: ignored
      { startsOn: "2026-03-11", endsOn: "2026-03-24", issueIds: ["a"] }, // running: ignored
    ];
    expect(velocity(cycles, issues, "2026-03-15")).toBe(7); // (8 + 2 + 11) / 3
    expect(velocity(cycles.slice(-1), issues, "2026-03-15")).toBeNull();
    expect(velocity([], issues, "2026-03-15")).toBeNull();
  });

  it("rounds velocity to one decimal", () => {
    const cycles = [
      { endsOn: "2026-01-14", issueIds: ["a"] },
      { endsOn: "2026-01-28", issueIds: ["d"] },
      { endsOn: "2026-02-11", issueIds: ["e"] },
    ];
    expect(velocity(cycles, issues, "2026-03-01")).toBe(4.3);
  });
});

describe("filterBySprint", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const cycles = [{ issueIds: ["a"] }, { issueIds: ["b"] }];
  it("filters by the running sprint, everything, or no sprint", () => {
    expect(filterBySprint(list, cycles, "active", cycles[0]).map((issue) => issue.id)).toEqual(["a"]);
    expect(filterBySprint(list, cycles, "active", null)).toEqual([]);
    expect(filterBySprint(list, cycles, "all", null)).toHaveLength(3);
    expect(filterBySprint(list, cycles, "backlog", cycles[0]).map((issue) => issue.id)).toEqual(["c"]);
  });
});
