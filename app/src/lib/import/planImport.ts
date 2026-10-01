import type { ImportBatch, ImportedProject, ImportedTask, ImportRecurrence } from "./types";

/** Where new projects (and tasks without a project) are filed. */
export type AreaChoice =
  | { mode: "source" }
  | { mode: "none" }
  | { mode: "existing"; name: string }
  | { mode: "new"; name: string };

export type ImportOptions = {
  /** Keys of the tasks ticked in the preview. */
  selected: ReadonlySet<string>;
  includeCompleted: boolean;
  skipDuplicates: boolean;
  area: AreaChoice;
};

/** Tasks already in Prior, to detect duplicates by title within a project. */
export type ExistingTask = { title: string; projectName: string | null };

/** What the app writes: a task with names to resolve, parents before children. */
export type PlanTask = {
  key: string;
  parentKey: string | null;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: ImportedTask["priority"];
  important: boolean;
  urgent: boolean;
  status: ImportedTask["status"];
  completed: boolean;
  projectName: string | null;
  areaName: string | null;
  estimatedMinutes: number | null;
  /** Wired into the task once recurring tasks exist (see recurrence.ts). */
  recurrence: ImportRecurrence | null;
};

export type ImportPlan = {
  projects: ImportedProject[];
  tasks: PlanTask[];
  skippedDuplicates: number;
};

function duplicateKey(projectName: string | null, title: string): string {
  return `${(projectName ?? "").trim().toLowerCase()}\u0000${title.trim().toLowerCase()}`;
}

export function resolveAreaName(choice: AreaChoice, sourceArea: string | null): string | null {
  switch (choice.mode) {
    case "none":
      return null;
    case "source":
      return sourceArea;
    default:
      return choice.name.trim() || null;
  }
}

/** Tasks that the options let through, before duplicates are looked at. */
export function eligibleTasks(batch: ImportBatch, options: Pick<ImportOptions, "selected" | "includeCompleted">): ImportedTask[] {
  return batch.tasks.filter((task) => options.selected.has(task.key) && (task.state === "open" || options.includeCompleted));
}

/** How many of the eligible tasks already exist in Prior. */
export function countDuplicates(tasks: readonly ImportedTask[], existing: readonly ExistingTask[]): number {
  const known = new Set(existing.map((task) => duplicateKey(task.projectName, task.title)));
  return tasks.filter((task) => known.has(duplicateKey(task.projectName, task.title))).length;
}

/**
 * Applies the preview's choices to a batch: the selected tasks, completed
 * ones only when asked, duplicates of existing tasks dropped, sub-tasks of a
 * dropped parent detached, parents ordered before their children, and the
 * area chosen for new projects.
 */
export function planImport(batch: ImportBatch, options: ImportOptions, existing: readonly ExistingTask[] = []): ImportPlan {
  const eligible = eligibleTasks(batch, options);
  const known = new Set(existing.map((task) => duplicateKey(task.projectName, task.title)));
  let skippedDuplicates = 0;
  const kept: ImportedTask[] = [];
  for (const task of eligible) {
    if (options.skipDuplicates && known.has(duplicateKey(task.projectName, task.title))) {
      skippedDuplicates += 1;
      continue;
    }
    kept.push(task);
  }
  const keptKeys = new Set(kept.map((task) => task.key));
  const byKey = new Map(kept.map((task) => [task.key, task]));
  const depth = (task: ImportedTask): number => {
    let level = 0;
    let current = task;
    const seen = new Set<string>();
    while (current.parentKey && keptKeys.has(current.parentKey) && !seen.has(current.key)) {
      seen.add(current.key);
      level += 1;
      current = byKey.get(current.parentKey) as ImportedTask;
    }
    return level;
  };
  const ordered = kept.map((task, index) => ({ task, index, level: depth(task) })).sort((left, right) => left.level - right.level || left.index - right.index);

  const tasks: PlanTask[] = ordered.map(({ task }) => ({
    key: task.key,
    parentKey: task.parentKey && keptKeys.has(task.parentKey) ? task.parentKey : null,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    important: task.important,
    urgent: task.urgent,
    status: task.state === "open" ? task.status : "done",
    completed: task.state !== "open",
    projectName: task.projectName,
    areaName: resolveAreaName(options.area, task.areaName),
    estimatedMinutes: task.estimatedMinutes,
    recurrence: task.recurrence,
  }));

  const used = new Set(tasks.map((task) => (task.projectName ?? "").trim().toLowerCase()).filter(Boolean));
  const projects = batch.projects
    .filter((project) => used.has(project.name.trim().toLowerCase()))
    .map((project) => ({ ...project, areaName: resolveAreaName(options.area, project.areaName) }));
  // Tasks without a project of their own can still be filed in the chosen area.
  return { projects, tasks, skippedDuplicates };
}
