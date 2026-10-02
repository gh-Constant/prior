import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { applyProjectKind } from "./agile";
import { sharedProjectPatch, visibleProjects } from "./sharedProject";

const server: Project = {
  id: "p1", areaId: "area-owner", name: "Team", description: "", icon: "folder", status: "active",
  health: null, startDate: null, targetDate: null, projectType: "software", methodology: "scrum",
  cycles: [], milestones: [], createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T08:00:00.000Z", deletedAt: null,
};

describe("sharedProjectPatch", () => {
  it("sends only what the person changed", () => {
    expect(sharedProjectPatch(server, { ...server, name: "Team 2" })).toEqual({ name: "Team 2" });
    expect(sharedProjectPatch(server, { ...server })).toEqual({});
  });

  it("sends the type and methodology when the kind changes", () => {
    const standard: Project = { ...server, projectType: "standard", methodology: undefined };
    expect(sharedProjectPatch(standard, applyProjectKind(standard, "scrum"))).toEqual({ projectType: "software", methodology: "scrum" });
    // Back to Standard keeps the methodology on the server.
    expect(sharedProjectPatch(server, applyProjectKind(server, "standard"))).toEqual({ projectType: "standard" });
  });

  it("never sends a stale type from a copy that did not change it", () => {
    // A copy that never knew the methodology (an older cache) cannot clear it.
    const { methodology: _ignored, ...withoutMethodology } = server;
    expect(sharedProjectPatch(server, { ...withoutMethodology, name: "Renamed" })).toEqual({ name: "Renamed" });
    // A sprint edit only carries the cycles.
    const cycles = [{ id: "c1", name: "Sprint 1", startsOn: "2026-10-01", endsOn: "2026-10-14", issueIds: [] }];
    expect(sharedProjectPatch(server, { ...server, cycles })).toEqual({ cycles });
  });

  it("can clear a value with null", () => {
    const planned: Project = { ...server, health: "At risk", targetDate: "2026-12-01" };
    expect(sharedProjectPatch(planned, { ...planned, health: null, targetDate: null })).toEqual({ health: null, targetDate: null });
  });
});

describe("visibleProjects", () => {
  const local: Project = { ...server, areaId: "area-mine", projectType: "standard", methodology: undefined, updatedAt: "2026-10-02T09:00:00.000Z" };

  it("shows the server copy of a shared project, with the person's own area", () => {
    const [shown] = visibleProjects([local], [server], () => true);
    expect(shown).toMatchObject({ projectType: "software", methodology: "scrum", areaId: "area-mine", updatedAt: server.updatedAt });
  });

  it("keeps the local copy of a project nobody else sees", () => {
    expect(visibleProjects([local], [server], () => false)).toEqual([local]);
  });

  it("adds the shared projects the person does not own", () => {
    const other: Project = { ...server, id: "p2" };
    expect(visibleProjects([], [other], () => true)).toEqual([other]);
  });
});
