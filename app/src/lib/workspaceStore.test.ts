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
});
