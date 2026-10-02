// Shared projects live on the server (specs/AGILE_COLLABORATION.md, "Project
// type"). What the members see is the server copy, so:
// - an edit is sent as a PATCH of the fields that changed, never as a whole
//   local copy that could carry a stale type or methodology;
// - the project shown is the server copy, not a personal copy that may never
//   have reached the server (a refused workspace sync, an older device).
import type { Project } from "../types";
import type { CollaborativeProjectPatch } from "./api";

const PATCH_FIELDS = ["name", "description", "status", "icon", "projectType", "methodology", "health", "startDate", "targetDate", "cycles", "milestones"] as const satisfies ReadonlyArray<keyof CollaborativeProjectPatch & keyof Project>;

function comparable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * The fields of `next` that differ from the server copy `server`. A field that
 * `next` leaves undefined is not sent (the server keeps it): switching to
 * Standard drops nothing, and a copy that never knew the methodology cannot
 * clear it.
 */
export function sharedProjectPatch(server: Project, next: Project): CollaborativeProjectPatch {
  const patch: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = next[field];
    if (value === undefined) continue;
    if (comparable(value) !== comparable(server[field])) patch[field] = value;
  }
  return patch as CollaborativeProjectPatch;
}

/**
 * The projects to show: personal projects, with the server copy taking over for
 * every shared one (the owner keeps their own area, which only organizes
 * their sidebar), then the shared projects the person does not own.
 */
export function visibleProjects(personal: readonly Project[], server: readonly Project[], isShared: (projectId: string) => boolean): Project[] {
  const serverById = new Map(server.map((project) => [project.id, project]));
  const personalIds = new Set(personal.map((project) => project.id));
  return [
    ...personal.map((project) => {
      const shared = serverById.get(project.id);
      return shared && isShared(project.id) ? { ...shared, areaId: project.areaId } : project;
    }),
    ...server.filter((project) => !personalIds.has(project.id)),
  ];
}
