// Agile methodologies (specs/SCRUM.md): which parts of the agile workspace a
// project turns on, and how its sprints (cycles) add up in story points.
import type { ProjectMethodology, ProjectType } from "../types";
import { normalizeStoryPoints, totalStoryPoints } from "./storyPoints";
import { validProjectMethodology } from "./projectPlanning";

type MethodologySource = { projectType?: ProjectType | null; methodology?: ProjectMethodology | null };

/** What the project picker offers: the project type and methodology as one choice. */
export type ProjectKind = "standard" | ProjectMethodology;
export const PROJECT_KINDS: readonly ProjectKind[] = ["standard", "kanban", "scrum", "scrumban"];

export type AgileFeatures = {
  /** Tasks carry story points, shown instead of the P1–P4 priority. */
  readonly points: boolean;
  /** Cycles are called sprints and get a sprint filter, velocity and points. */
  readonly sprints: boolean;
  /** Planning Poker tab. */
  readonly poker: boolean;
};

const NO_FEATURES: AgileFeatures = { points: false, sprints: false, poker: false };
const FEATURES: Record<ProjectMethodology, AgileFeatures> = {
  kanban: NO_FEATURES,
  scrum: { points: true, sprints: true, poker: true },
  scrumban: { points: true, sprints: false, poker: true },
};

/** The methodology of an agile (software) project; absent means kanban. Null for a standard project. */
export function projectMethodology(project: MethodologySource | null | undefined): ProjectMethodology | null {
  if (!project || project.projectType !== "software") return null;
  return validProjectMethodology(project.methodology) ?? "kanban";
}

/** Features turned on for a project. Standard and Kanban projects have none: they behave as before. */
export function agileFeatures(project: MethodologySource | null | undefined): AgileFeatures {
  const methodology = projectMethodology(project);
  return methodology ? FEATURES[methodology] : NO_FEATURES;
}

/** "points" when tasks of the project show story points in place of the priority glyph. */
export function taskBadgeKind(project: MethodologySource | null | undefined): "points" | "priority" {
  return agileFeatures(project).points ? "points" : "priority";
}

/** The choice of the project picker for a project. */
export function projectKindOf(project: MethodologySource | null | undefined): ProjectKind {
  return projectMethodology(project) ?? "standard";
}

/**
 * Applies a picker choice. "standard" only changes the type: a methodology that
 * was chosen earlier stays in place (and is ignored) so switching back restores
 * it, and the key is never written as null (a device that does not know the
 * field would otherwise wipe it).
 */
export function applyProjectKind<T extends MethodologySource>(project: T, kind: ProjectKind): T & { projectType: ProjectType; methodology?: ProjectMethodology | null } {
  if (kind === "standard") return { ...project, projectType: "standard" };
  return { ...project, projectType: "software", methodology: kind };
}

/** Total of the estimated issues (null / missing count for nothing). */
export function sumStoryPoints(items: ReadonlyArray<{ storyPoints?: number | null }>): number {
  return totalStoryPoints(items);
}

export type SprintIssue = { readonly id: string; readonly storyPoints?: number | null; readonly done: boolean };
type SprintLike = { readonly issueIds?: readonly string[] | null };
export type SprintStats = {
  /** Issues in the sprint. */
  readonly issues: number;
  readonly doneIssues: number;
  /** Points of every issue in the sprint. */
  readonly committed: number;
  /** Points of the issues that are done. */
  readonly done: number;
  /** Issues without an estimate. */
  readonly unestimated: number;
};

/** Committed vs done points of a sprint (cycle), from the issues it lists. */
export function sprintStats(cycle: SprintLike, issues: readonly SprintIssue[]): SprintStats {
  const ids = new Set(cycle.issueIds ?? []);
  const assigned = issues.filter((issue) => ids.has(issue.id));
  const finished = assigned.filter((issue) => issue.done);
  return {
    issues: assigned.length,
    doneIssues: finished.length,
    committed: sumStoryPoints(assigned),
    done: sumStoryPoints(finished),
    unestimated: assigned.filter((issue) => normalizeStoryPoints(issue.storyPoints) === null).length,
  };
}

type DatedSprint = SprintLike & { readonly startsOn?: string | null; readonly endsOn?: string | null };

/** Sprints that ended before `today` (YYYY-MM-DD), the most recent first. */
function pastSprints<T extends DatedSprint>(cycles: readonly T[], today: string): T[] {
  return cycles
    .filter((cycle) => Boolean(cycle.endsOn) && (cycle.endsOn as string) < today)
    .sort((left, right) => (right.endsOn as string).localeCompare(left.endsOn as string));
}

/** How many past sprints the velocity averages. */
export const VELOCITY_WINDOW = 3;

/**
 * Velocity: average done points of the last three finished sprints that had work
 * in them, rounded to one decimal. Null while there is no finished sprint.
 */
export function velocity(cycles: readonly DatedSprint[], issues: readonly SprintIssue[], today: string): number | null {
  const stats = pastSprints(cycles, today)
    .map((cycle) => sprintStats(cycle, issues))
    .filter((entry) => entry.issues > 0)
    .slice(0, VELOCITY_WINDOW);
  if (!stats.length) return null;
  const average = stats.reduce((sum, entry) => sum + entry.done, 0) / stats.length;
  return Math.round(average * 10) / 10;
}

/** Which sprint the issue list shows: the running one, all issues, or the ones in no sprint. */
export type SprintFilter = "active" | "all" | "backlog";

/** Keeps the issues that belong to the chosen sprint scope. */
export function filterBySprint<T extends { readonly id: string }>(
  issues: readonly T[],
  cycles: readonly SprintLike[],
  filter: SprintFilter,
  activeCycle: SprintLike | null,
): T[] {
  if (filter === "all") return [...issues];
  if (filter === "active") {
    const ids = new Set(activeCycle?.issueIds ?? []);
    return issues.filter((issue) => ids.has(issue.id));
  }
  const inSprint = new Set(cycles.flatMap((cycle) => cycle.issueIds ?? []));
  return issues.filter((issue) => !inSprint.has(issue.id));
}
