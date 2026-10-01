import { describe, expect, it } from "vitest";
import { FIXTURES, TODAY } from "./__fixtures__";
import { analyzeFile, parseAll } from "./analyze";
import { countDuplicates, eligibleTasks, planImport, type ImportOptions } from "./planImport";

const todoist = parseAll([analyzeFile(FIXTURES.todoist)], { today: TODAY });
const linear = parseAll([analyzeFile(FIXTURES.linear)], { today: TODAY });

function options(batch: typeof todoist, overrides: Partial<ImportOptions> = {}): ImportOptions {
  return { selected: new Set(batch.tasks.map((task) => task.key)), includeCompleted: false, skipDuplicates: true, area: { mode: "none" }, ...overrides };
}

describe("planImport", () => {
  it("imports the selected tasks only, parents before children", () => {
    const keys = new Map(todoist.tasks.map((task) => [task.title, task.key]));
    const selected = new Set([keys.get("Draft the FAQ"), keys.get("Review with the team"), keys.get("Plan the launch"), keys.get("Pay the rent")] as string[]);
    const plan = planImport(todoist, options(todoist, { selected }));
    expect(plan.tasks.map((task) => task.title)).toEqual(["Plan the launch", "Pay the rent", "Review with the team", "Draft the FAQ"]);
    expect(plan.projects.map((project) => project.name)).toEqual(["Home"]);
  });

  it("detaches sub-tasks whose parent is left out", () => {
    const keys = new Map(todoist.tasks.map((task) => [task.title, task.key]));
    const selected = new Set([keys.get("Write the announcement")] as string[]);
    const plan = planImport(todoist, options(todoist, { selected }));
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].parentKey).toBeNull();
  });

  it("leaves out completed and canceled tasks unless asked, and marks them done when kept", () => {
    const without = planImport(linear, options(linear));
    expect(without.tasks.map((task) => task.title)).not.toContain("Remove the legacy endpoint");
    expect(without.tasks.map((task) => task.title)).not.toContain("Try the new editor");
    expect(without.tasks).toHaveLength(4);
    const withDone = planImport(linear, options(linear, { includeCompleted: true }));
    expect(withDone.tasks).toHaveLength(6);
    const done = withDone.tasks.find((task) => task.title === "Remove the legacy endpoint");
    expect(done).toMatchObject({ completed: true, status: "done" });
    expect(withDone.tasks.find((task) => task.title === "Try the new editor")).toMatchObject({ completed: true, status: "done" });
    expect(withDone.tasks.find((task) => task.title === "Set up the CI pipeline")).toMatchObject({ completed: false, status: "in_progress" });
  });

  it("skips duplicates of existing tasks in the same project, case-insensitively", () => {
    const existing = [{ title: "plan the LAUNCH", projectName: "home" }, { title: "Pay the rent", projectName: "Elsewhere" }];
    const plan = planImport(todoist, options(todoist), existing);
    expect(plan.skippedDuplicates).toBe(1);
    expect(plan.tasks.map((task) => task.title)).not.toContain("Plan the launch");
    expect(plan.tasks.map((task) => task.title)).toContain("Pay the rent");
    expect(countDuplicates(eligibleTasks(todoist, options(todoist)), existing)).toBe(1);
    expect(planImport(todoist, options(todoist, { skipDuplicates: false }), existing).skippedDuplicates).toBe(0);
  });

  it("files projects and loose tasks in the chosen area", () => {
    expect(planImport(linear, options(linear, { area: { mode: "source" } })).projects.map((project) => project.areaName)).toEqual(["Engineering", "Engineering", "Design"]);
    expect(planImport(linear, options(linear, { area: { mode: "none" } })).projects.every((project) => project.areaName === null)).toBe(true);
    const named = planImport(todoist, options(todoist, { area: { mode: "new", name: " Todoist " } }));
    expect(named.projects[0].areaName).toBe("Todoist");
    expect(named.tasks.every((task) => task.areaName === "Todoist")).toBe(true);
  });

  it("only creates projects that keep a task", () => {
    const keys = new Map(linear.tasks.map((task) => [task.title, task.key]));
    const plan = planImport(linear, options(linear, { selected: new Set([keys.get("Cache the Docker layers")] as string[]) }));
    expect(plan.projects.map((project) => project.name)).toEqual(["Platform"]);
    expect(plan.projects[0].projectType).toBe("software");
  });
});
