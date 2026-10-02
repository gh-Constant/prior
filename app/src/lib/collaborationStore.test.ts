import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../types";
import { collaborationStore } from "./collaborationStore";

function project(extra: Record<string, unknown> = {}): Project {
  return { id: "p1", areaId: null, name: "Shared app", description: "", status: "active", projectType: "software", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", deletedAt: null, ...extra } as Project;
}

describe("collaborationStore methodology", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear() } as unknown as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true } as unknown as Window });
  });

  it("keeps a valid methodology", () => {
    for (const methodology of ["kanban", "scrum", "scrumban"]) {
      collaborationStore.merge([{ project: project({ methodology }), role: "owner", members: [] }]);
      expect(collaborationStore.listProjects()[0]?.methodology).toBe(methodology);
    }
  });

  it("deletes the key when the methodology is missing, null or unknown", () => {
    for (const methodology of [undefined, null, "waterfall", 3]) {
      collaborationStore.merge([{ project: project({ methodology }), role: "owner", members: [] }]);
      const stored = collaborationStore.listProjects()[0];
      expect(stored).toBeDefined();
      expect(Object.keys(stored!)).not.toContain("methodology");
      expect(Object.keys(collaborationStore.get("p1")!.project)).not.toContain("methodology");
    }
  });
});
