import { beforeEach, describe, expect, it } from "vitest";
import { notesStore } from "./notes";
import { workspaceStore } from "./workspaceStore";

describe("workspaceStore", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear() } as unknown as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true } as unknown as Window });
    localStorage.clear();
  });

  it("organizes projects under areas and moves them to no area when an area is removed", () => {
    const area = workspaceStore.createArea("Work");
    const project = workspaceStore.createProject("Launch site", area.id);
    expect(workspaceStore.listAreas()[0]).toMatchObject({ name: "Work", icon: "briefcase" });
    expect(workspaceStore.listProjects()[0]).toMatchObject({ name: "Launch site", areaId: area.id, icon: "folder", status: "active" });
    const areaFolder = notesStore.getWorkspaceFolder("area", area.id);
    const projectFolder = notesStore.getWorkspaceFolder("project", project.id);
    expect(areaFolder).toMatchObject({ name: "Work", workspaceKind: "area", icon: "briefcase" });
    expect(projectFolder).toMatchObject({ name: "Launch site", workspaceKind: "project", parentId: areaFolder?.id, icon: "folder" });

    workspaceStore.removeArea(area);
    expect(workspaceStore.listAreas()).toEqual([]);
    expect(workspaceStore.listProjects()[0]?.areaId).toBeNull();
    expect(notesStore.getWorkspaceFolder("area", area.id)).toBeNull();
    expect(notesStore.getWorkspaceFolder("project", project.id)?.parentId).toBeNull();
    expect(project.id).toBeTruthy();
  });

  it("updates project status without changing its identity", () => {
    const project = workspaceStore.createProject("Exam prep");
    const updated = workspaceStore.updateProject({ ...project, status: "paused" });
    expect(updated).toMatchObject({ id: project.id, name: "Exam prep", status: "paused" });
  });

  it("merges remote workspace items without losing newer local edits", () => {
    const area = workspaceStore.createArea("Local area");
    const project = workspaceStore.createProject("Local project", area.id);
    const local = workspaceStore.exportAll();
    workspaceStore.mergeRemote({
      areas: [{ ...area, name: "Older remote name", updatedAt: "2020-01-01T00:00:00.000Z" }],
      projects: [{ ...project, name: "Remote project", updatedAt: "2999-01-01T00:00:00.000Z" }],
    });
    expect(workspaceStore.exportAll().areas.find((item) => item.id === area.id)?.name).toBe(local.areas.find((item) => item.id === area.id)?.name);
    expect(workspaceStore.exportAll().projects.find((item) => item.id === project.id)?.name).toBe("Remote project");
  });

  it("persists and normalizes project planning fields (health, dates, cycles)", () => {
    const project = workspaceStore.createProject("Sprint alpha");
    const updated = workspaceStore.updateProject({
      ...project,
      health: "On track",
      startDate: "2026-09-01",
      targetDate: "2026-09-30",
      cycles: [
        {
          id: "cycle-1",
          name: "Cycle 1",
          startsOn: "2026-09-01",
          endsOn: "2026-09-14",
          issueIds: ["task-1", "task-2"],
        },
      ],
    });
    expect(updated).toMatchObject({
      health: "On track",
      startDate: "2026-09-01",
      targetDate: "2026-09-30",
      cycles: [
        {
          id: "cycle-1",
          name: "Cycle 1",
          startsOn: "2026-09-01",
          endsOn: "2026-09-14",
          issueIds: ["task-1", "task-2"],
        },
      ],
    });

    const retrieved = workspaceStore.listProjects().find((p) => p.id === project.id);
    expect(retrieved?.health).toBe("On track");
    expect(retrieved?.startDate).toBe("2026-09-01");
    expect(retrieved?.targetDate).toBe("2026-09-30");
    expect(retrieved?.cycles).toHaveLength(1);
    expect(retrieved?.cycles?.[0]?.issueIds).toEqual(["task-1", "task-2"]);
  });
});
