import { cell, findColumn, type CsvTable } from "./csv";
import { parseLooseDate } from "./dates";
import { collectProjects, emptyBatch, makeTask, MAX_DESCRIPTION_LENGTH, MAX_IMPORT_TASKS, type ImportBatch, type ImportedState, type ImportedTask } from "./types";
import type { ParseOptions } from "./todoist";
import type { TaskPriority, TaskStatus } from "../../types";

/** True when the headers look like a Linear export (ID, Title, Status…). */
export function isLinearTable(table: CsvTable): boolean {
  const has = (name: string) => findColumn(table.headers, [name]) >= 0;
  return has("id") && has("title") && has("status") && (has("team") || has("priority") || has("project") || has("identifier"));
}

function priorityFrom(value: string): TaskPriority {
  const text = value.trim().toLowerCase();
  if (text === "urgent" || text === "1") return 1;
  if (text === "high" || text === "2") return 2;
  if (text === "medium" || text === "3") return 3;
  return 4;
}

type Mapped = { status: TaskStatus; state: ImportedState };

/** Status by name first, then by the timestamps Linear writes next to it. */
function statusFrom(name: string, completedAt: string, canceledAt: string, startedAt: string): Mapped {
  const text = name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^(triage|inbox)$/.test(text)) return { status: "inbox", state: "open" };
  if (/^(backlog)$/.test(text)) return { status: "backlog", state: "open" };
  if (/^(todo|to do|unstarted|planned|ready|selected for development)$/.test(text)) return { status: "next", state: "open" };
  if (/^(in progress|in review|started|in development|in qa|in testing|review|doing)$/.test(text)) return { status: "in_progress", state: "open" };
  if (/^(done|completed|complete|shipped|released|merged)$/.test(text)) return { status: "done", state: "completed" };
  if (/^(canceled|cancelled|duplicate|won t fix|wontfix|obsolete)$/.test(text)) return { status: "done", state: "canceled" };
  if (canceledAt) return { status: "done", state: "canceled" };
  if (completedAt) return { status: "done", state: "completed" };
  if (startedAt) return { status: "in_progress", state: "open" };
  return { status: "next", state: "open" };
}

/**
 * Linear CSV (Settings -> Import/Export -> Export CSV). Issues of a Linear
 * project become a software project; issues without one go to a project named
 * after their team, and the team becomes the area. Assignees are not mapped
 * to Prior members: they are kept in the description.
 */
export function parseLinear(table: CsvTable, options: ParseOptions = {}): ImportBatch {
  const batch = emptyBatch("linear");
  const column = (...names: string[]) => findColumn(table.headers, names);
  const idColumn = column("id", "identifier");
  const teamColumn = column("team");
  const titleColumn = column("title");
  const descriptionColumn = column("description");
  const statusColumn = column("status", "state");
  const priorityColumn = column("priority");
  const projectColumn = column("project", "project name");
  const assigneeColumn = column("assignee");
  const labelsColumn = column("labels");
  const dueColumn = column("due date", "due");
  const parentColumn = column("parent issue", "parent", "parent id");
  const milestoneColumn = column("project milestone", "milestone");
  const startedColumn = column("started");
  const completedColumn = column("completed");
  const canceledColumn = column("canceled", "cancelled");

  const byIdentifier = new Map<string, ImportedTask>();
  const parents = new Map<ImportedTask, string>();
  let sequence = 0;
  for (const row of table.rows) {
    const title = cell(row, titleColumn);
    if (!title) continue;
    if (batch.tasks.length >= MAX_IMPORT_TASKS) {
      batch.warnings.push({ code: "truncated", count: MAX_IMPORT_TASKS, file: options.fileName });
      break;
    }
    sequence += 1;
    const identifier = cell(row, idColumn);
    const team = cell(row, teamColumn);
    const project = cell(row, projectColumn) || team || "Linear";
    const { status, state } = statusFrom(cell(row, statusColumn), cell(row, completedColumn), cell(row, canceledColumn), cell(row, startedColumn));
    const due = parseLooseDate(cell(row, dueColumn), { ...options, order: "dmy" });
    const notes: string[] = [];
    const labels = cell(row, labelsColumn);
    if (labels) notes.push(`Labels: ${labels}`);
    const assignee = cell(row, assigneeColumn);
    if (assignee) notes.push(`Assignee: ${assignee}`);
    const milestone = cell(row, milestoneColumn);
    if (milestone) notes.push(`Milestone: ${milestone}`);
    if (identifier) notes.push(`Linear: ${identifier}`);
    const description = [cell(row, descriptionColumn), ...notes].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION_LENGTH);
    const task = makeTask(identifier || `linear:${sequence}`, title, {
      description,
      priority: priorityFrom(cell(row, priorityColumn)),
      dueDate: due?.date ?? null,
      status,
      state,
      projectName: project,
      areaName: team || null,
    });
    batch.tasks.push(task);
    if (identifier) byIdentifier.set(identifier, task);
    const parent = cell(row, parentColumn);
    if (parent) parents.set(task, parent);
  }

  let detached = 0;
  for (const [task, parentId] of parents) {
    const parent = byIdentifier.get(parentId);
    // Prior sub-tasks live in their parent's project.
    if (parent && parent !== task && parent.projectName === task.projectName) {
      task.parentKey = parent.key;
    } else {
      detached += 1;
      task.description = [task.description, `Parent issue: ${parentId}`].filter(Boolean).join("\n\n");
    }
  }
  if (detached > 0) batch.warnings.push({ code: "parents", count: detached, file: options.fileName });
  collectProjects(batch, { projectType: "software" });
  return batch;
}
