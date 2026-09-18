import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ICON_OPTIONS, PROJECT_ICON_OPTIONS } from "../components/WorkspaceIcon";
import {
  buildDevSeed,
  clearDevSeedData,
  DEV_SEED_ID_PREFIX,
  isDevSeedId,
  seedDevDataIfEmpty,
} from "./devSeed";
import { localStore } from "./localStore";
import { workspaceStore } from "./workspaceStore";

function installMemoryStorage(): void {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true } as unknown as Window,
  });
  localStorage.clear();
}

describe("devSeed", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("is DEV-only: never touches stores outside dev", async () => {
    const result = await seedDevDataIfEmpty({ dev: false, force: true });
    expect(result).toMatchObject({ seeded: false, reason: "not-dev" });
    expect(await localStore.listTasks()).toEqual([]);
    expect(workspaceStore.listAreas()).toEqual([]);
    expect(workspaceStore.listProjects()).toEqual([]);

    const cleared = await clearDevSeedData({ dev: false });
    expect(cleared).toEqual({ tasks: 0, projects: 0, areas: 0 });
  });

  it("never overwrites real user data without force", async () => {
    await localStore.saveTask({ title: "Real task", important: false, urgent: false });
    const result = await seedDevDataIfEmpty({ dev: true });
    expect(result).toMatchObject({ seeded: false, reason: "non-empty" });
    expect((await localStore.listTasks()).map((task) => task.title)).toEqual(["Real task"]);
  });

  it("seeds once and is idempotent on the second run", async () => {
    const first = await seedDevDataIfEmpty({ dev: true });
    expect(first).toMatchObject({ seeded: true, reason: "seeded" });
    const tasksAfterFirst = await localStore.listTasks();
    const areasAfterFirst = workspaceStore.listAreas();
    const projectsAfterFirst = workspaceStore.listProjects();

    expect(tasksAfterFirst.length).toBeGreaterThan(5);
    expect(areasAfterFirst).toHaveLength(2);
    expect(projectsAfterFirst).toHaveLength(4);

    const second = await seedDevDataIfEmpty({ dev: true, force: true });
    expect(second).toMatchObject({ seeded: true });
    expect(await localStore.listTasks()).toHaveLength(tasksAfterFirst.length);
    expect(workspaceStore.listAreas()).toHaveLength(areasAfterFirst.length);
    expect(workspaceStore.listProjects()).toHaveLength(projectsAfterFirst.length);

    const ids = (await localStore.listTasks()).map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
  });

  it("covers tasks with/without project, today/due, assignment, board columns and an empty project", async () => {
    const baseDate = new Date(2026, 8, 18); // local Sep 18 2026
    const snapshot = buildDevSeed(baseDate);
    const today = "2026-09-18";

    // Fixed dev-seed ids everywhere.
    for (const id of [
      ...snapshot.areas.map((area) => area.id),
      ...snapshot.projects.map((project) => project.id),
      ...snapshot.tasks.map((task) => task.id),
    ]) {
      expect(isDevSeedId(id)).toBe(true);
      expect(id.startsWith(DEV_SEED_ID_PREFIX)).toBe(true);
    }

    // Tasks with and without a project.
    expect(snapshot.tasks.some((task) => !task.projectId)).toBe(true);
    expect(snapshot.tasks.some((task) => Boolean(task.projectId))).toBe(true);

    // Today + due coverage.
    expect(snapshot.tasks.some((task) => task.dueDate === today)).toBe(true);
    expect(snapshot.tasks.some((task) => typeof task.dueDate === "string" && task.dueDate !== today)).toBe(true);

    // Assigned to me / delegated.
    expect(snapshot.tasks.some((task) => Boolean(task.assigneeName))).toBe(true);

    // Board columns on the demo board project: inbox/backlog/next/in_progress/done
    // populated, waiting intentionally empty.
    const boardProjectId = `${DEV_SEED_ID_PREFIX}project-website`;
    const boardByStatus = new Map<string, number>();
    for (const task of snapshot.tasks.filter((item) => item.projectId === boardProjectId)) {
      const status = task.completed ? "done" : task.status ?? "inbox";
      boardByStatus.set(status, (boardByStatus.get(status) ?? 0) + 1);
    }
    for (const status of ["inbox", "backlog", "next", "in_progress", "done"]) {
      expect(boardByStatus.get(status) ?? 0).toBeGreaterThanOrEqual(1);
    }
    expect(boardByStatus.get("waiting") ?? 0).toBe(0);

    // One empty project demonstrates "No issues yet".
    const emptyProjectId = `${DEV_SEED_ID_PREFIX}project-garden`;
    expect(snapshot.tasks.filter((task) => task.projectId === emptyProjectId)).toHaveLength(0);

    // Cycles reference real board issue ids.
    expect(snapshot.cycles.length).toBeGreaterThanOrEqual(1);
    const boardIds = new Set(snapshot.tasks.map((task) => task.id));
    for (const cycle of snapshot.cycles) {
      expect(cycle.issueIds?.length).toBeGreaterThan(0);
      for (const issueId of cycle.issueIds ?? []) expect(boardIds.has(issueId)).toBe(true);
    }

    // People cover avatar rendering (data URL + https).
    expect(snapshot.people.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.people.some((person) => person.avatarUrl?.startsWith("data:image/"))).toBe(true);
  });

  it("uses only guaranteed icons plus one image icon", async () => {
    const snapshot = buildDevSeed(new Date(2026, 8, 18));
    const isImageIcon = (icon?: string | null) => Boolean(icon?.startsWith("data:image/") || icon?.startsWith("https://"));

    for (const area of snapshot.areas) {
      expect(isImageIcon(area.icon) || (AREA_ICON_OPTIONS as readonly string[]).includes(area.icon ?? "")).toBe(true);
    }
    let imageCount = 0;
    for (const project of snapshot.projects) {
      if (isImageIcon(project.icon)) imageCount += 1;
      else expect((PROJECT_ICON_OPTIONS as readonly string[]).includes(project.icon ?? "")).toBe(true);
    }
    expect(imageCount).toBeGreaterThanOrEqual(1);
  });
});
