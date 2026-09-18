import type { Project, ProjectCycle, ProjectHealth } from "../types";

export const PROJECT_HEALTH_VALUES: readonly ProjectHealth[] = ["On track", "At risk", "Off track"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ProjectPlanning = {
  health: ProjectHealth | null;
  startDate: string | null;
  targetDate: string | null;
  cycles: ProjectCycle[];
};

export type ProjectPlanningInput = Partial<Pick<Project, "health" | "startDate" | "targetDate" | "cycles">>;

function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value.trim()) ? value.trim() : null;
}

function normalizeCycle(value: unknown): ProjectCycle | null {
  if (!value || typeof value !== "object") return null;
  const cycle = value as Partial<ProjectCycle>;
  const id = typeof cycle.id === "string" ? cycle.id.trim() : "";
  const name = typeof cycle.name === "string" ? cycle.name.trim() : "";
  const startsOn = normalizeDate(cycle.startsOn);
  const endsOn = normalizeDate(cycle.endsOn);
  if (!id || !name || !startsOn || !endsOn) return null;
  const issueIds = Array.isArray(cycle.issueIds)
    ? [...new Set(cycle.issueIds.filter((issueId): issueId is string => typeof issueId === "string" && issueId.trim().length > 0).map((issueId) => issueId.trim()))]
    : [];
  return { id, name, startsOn, endsOn, issueIds };
}

export function normalizeProjectPlanning(input: ProjectPlanningInput): ProjectPlanning {
  const health = PROJECT_HEALTH_VALUES.includes(input.health as ProjectHealth) ? input.health as ProjectHealth : null;
  const cycles = Array.isArray(input.cycles)
    ? input.cycles.map(normalizeCycle).filter((cycle): cycle is ProjectCycle => cycle !== null)
    : [];
  return {
    health,
    startDate: normalizeDate(input.startDate),
    targetDate: normalizeDate(input.targetDate),
    cycles,
  };
}

export function projectPlanningFromProject(project: Project): ProjectPlanning {
  return normalizeProjectPlanning(project);
}

export function withProjectPlanning(project: Project, planning: ProjectPlanningInput): Project {
  return { ...project, ...normalizeProjectPlanning(planning) };
}
