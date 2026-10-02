import type { ProjectType, TaskPriority, TaskStatus } from "../../types";

/** Where an import batch came from. "text" is a pasted list; "csv" any other table. */
export type ImportSource = "todoist" | "linear" | "notion" | "csv" | "text";

/**
 * A repeat rule found in an export. Same shape as the planned
 * `TaskRecurrence`, kept separate until recurring tasks land in `Task`.
 */
export type ImportRecurrence = {
  interval: number;
  unit: "day" | "week" | "month" | "year";
  daysOfWeek?: number[];
  basis?: "due" | "completion";
  until?: string | null;
};

/** open tasks are imported by default; completed and canceled ones only when asked. */
export type ImportedState = "open" | "completed" | "canceled";

/** One task as read from a file, before the user decides what to import. */
export type ImportedTask = {
  /** Unique within the batch; `parentKey` points at another task's key. */
  key: string;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: TaskPriority;
  important: boolean;
  urgent: boolean;
  status: TaskStatus;
  state: ImportedState;
  projectName: string | null;
  areaName: string | null;
  parentKey: string | null;
  recurrence: ImportRecurrence | null;
  estimatedMinutes: number | null;
  /** Size in story points (Linear's Estimate column), when the export has one. */
  storyPoints: number | null;
};

export type ImportedProject = {
  name: string;
  areaName: string | null;
  projectType: ProjectType;
};

/**
 * Something that could not be read perfectly. Structured so the UI can word
 * it in the user's language: `count` and `file` fill the placeholders.
 */
export type ImportWarning = {
  code:
    | "dates" // unreadable dates, kept in the description
    | "truncated" // more rows than MAX_IMPORT_TASKS
    | "parents" // parent issues outside the file or in another project
    | "archive" // an archive could not be opened
    | "archiveLimit" // too many files in an archive
    | "noCsv" // an archive without CSV files
    | "tooLarge" // a file over the size limit
    | "aiPartial" // a request failed; that part was read without AI
    | "aiTooLong" // a file too long for the AI request budget
    | "aiRows" // only the first rows were organised by AI
    | "aiKept"; // AI results cut to AI_MAX_TASKS
  count?: number;
  file?: string;
};

export type ImportBatch = {
  source: ImportSource;
  projects: ImportedProject[];
  tasks: ImportedTask[];
  warnings: ImportWarning[];
};

/** A file the user dropped, already unzipped to text. */
export type ImportFile = { name: string; text: string };

export const MAX_IMPORT_TASKS = 5000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 8000;

export function emptyBatch(source: ImportSource): ImportBatch {
  return { source, projects: [], tasks: [], warnings: [] };
}

/** Eisenhower flags derived from a Todoist-style priority. */
export function flagsForPriority(priority: TaskPriority): { important: boolean; urgent: boolean } {
  return { important: priority <= 2, urgent: priority === 1 };
}

export function makeTask(key: string, title: string, extra: Partial<ImportedTask> = {}): ImportedTask {
  const priority = extra.priority ?? 4;
  const flags = flagsForPriority(priority);
  return {
    key,
    title: title.trim().slice(0, MAX_TITLE_LENGTH),
    description: "",
    dueDate: null,
    dueTime: null,
    priority,
    important: flags.important,
    urgent: flags.urgent,
    status: "inbox",
    state: "open",
    projectName: null,
    areaName: null,
    parentKey: null,
    recurrence: null,
    estimatedMinutes: null,
    storyPoints: null,
    ...extra,
  };
}

/** Adds each task's project to `batch.projects` once (case-insensitive). */
export function collectProjects(batch: ImportBatch, defaults: Partial<ImportedProject> = {}): void {
  const seen = new Set(batch.projects.map((project) => project.name.trim().toLowerCase()));
  for (const task of batch.tasks) {
    const name = task.projectName?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    batch.projects.push({ name, areaName: task.areaName, projectType: "standard", ...defaults });
  }
}

/** Merges batches read from several files into one. */
export function mergeBatches(batches: readonly ImportBatch[]): ImportBatch {
  if (batches.length === 0) return emptyBatch("csv");
  const merged = emptyBatch(batches[0].source);
  const projects = new Map<string, ImportedProject>();
  const keys = new Set<string>();
  batches.forEach((batch, index) => {
    // Keys only need to be unique inside a batch; make them unique overall.
    const remap = new Map<string, string>();
    for (const task of batch.tasks) {
      let key = task.key;
      if (keys.has(key)) key = `${key}#${index}`;
      keys.add(key);
      remap.set(task.key, key);
    }
    for (const task of batch.tasks) {
      merged.tasks.push({ ...task, key: remap.get(task.key) ?? task.key, parentKey: task.parentKey ? remap.get(task.parentKey) ?? null : null });
    }
    for (const project of batch.projects) {
      const id = project.name.trim().toLowerCase();
      const existing = projects.get(id);
      if (!existing) projects.set(id, { ...project });
      else if (project.projectType === "software") existing.projectType = "software";
    }
    merged.warnings.push(...batch.warnings);
  });
  merged.projects = [...projects.values()];
  return merged;
}
