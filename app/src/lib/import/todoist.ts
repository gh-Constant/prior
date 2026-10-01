import { cell, findColumn, type CsvTable } from "./csv";
import { inferDayOrder, looksRecurring, parseLooseDate, type DayOrder } from "./dates";
import { toRecurrence } from "./recurrence";
import { collectProjects, emptyBatch, makeTask, MAX_DESCRIPTION_LENGTH, MAX_IMPORT_TASKS, type ImportBatch, type ImportedTask } from "./types";
import type { TaskPriority } from "../../types";

export type ParseOptions = {
  /** The file's name, used as the project name when the format has none. */
  fileName?: string;
  order?: DayOrder;
  today?: Date;
};

/** True when the headers look like a Todoist export (TYPE + CONTENT). */
export function isTodoistTable(table: CsvTable): boolean {
  return findColumn(table.headers, ["type"]) >= 0 && findColumn(table.headers, ["content"]) >= 0;
}

/** "Home [6Jf8VQXj].csv" or "folder/Home.csv" -> "Home". */
export function projectNameFromFile(fileName: string | undefined, fallback: string): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, "")
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .replace(/_/g, " ")
    .trim();
  return name || fallback;
}

const DOING = /^(doing|in progress|wip|en cours|in arbeit|en curso|em andamento|em curso)$/i;

/** Todoist's CSV priority is 4 for P1 down to 1 for P4. */
function priorityFrom(value: string): TaskPriority {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4) return 4;
  return (5 - number) as TaskPriority;
}

function durationMinutes(amount: string, unit: string): number | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const lower = unit.toLowerCase();
  if (lower.startsWith("hour") || lower.startsWith("heure")) return Math.round(value * 60);
  if (lower.startsWith("day") || lower.startsWith("jour")) return Math.round(value * 60 * 8);
  return Math.round(value);
}

function appendNote(task: ImportedTask, note: string): void {
  const text = note.trim();
  if (!text) return;
  task.description = task.description ? `${task.description}\n\n${text}` : text;
  if (task.description.length > MAX_DESCRIPTION_LENGTH) task.description = task.description.slice(0, MAX_DESCRIPTION_LENGTH);
}

/**
 * Todoist CSV (project ⋯ -> Export as CSV, or a backup .zip). One file is one
 * project. Sub-tasks come from INDENT, comments (note rows) are appended to
 * the task above, and a section called "Doing" puts its tasks in progress.
 */
export function parseTodoist(table: CsvTable, options: ParseOptions = {}): ImportBatch {
  const batch = emptyBatch("todoist");
  const typeColumn = findColumn(table.headers, ["type"]);
  const contentColumn = findColumn(table.headers, ["content", "title", "name"]);
  const descriptionColumn = findColumn(table.headers, ["description"]);
  const priorityColumn = findColumn(table.headers, ["priority"]);
  const indentColumn = findColumn(table.headers, ["indent"]);
  const responsibleColumn = findColumn(table.headers, ["responsible"]);
  const dateColumn = findColumn(table.headers, ["date", "due date"]);
  const deadlineColumn = findColumn(table.headers, ["deadline"]);
  const durationColumn = findColumn(table.headers, ["duration"]);
  const durationUnitColumn = findColumn(table.headers, ["duration unit"]);
  options = { ...options, order: inferDayOrder(table.rows.map((row) => cell(row, dateColumn)), options.order) };
  const project = projectNameFromFile(options.fileName, "Todoist");
  const prefix = project.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "todoist";

  const stack: string[] = [];
  let lastTask: ImportedTask | null = null;
  let section = "";
  let unreadDates = 0;

  for (const row of table.rows) {
    const type = typeColumn >= 0 ? cell(row, typeColumn).toLowerCase() : "task";
    const content = cell(row, contentColumn);
    if (type === "section") {
      section = content;
      stack.length = 0;
      lastTask = null;
      continue;
    }
    if (type === "note") {
      if (lastTask) appendNote(lastTask, content);
      continue;
    }
    if (type !== "task" && type !== "") continue;
    if (!content) continue;
    if (batch.tasks.length >= MAX_IMPORT_TASKS) {
      batch.warnings.push({ code: "truncated", count: MAX_IMPORT_TASKS, file: options.fileName });
      break;
    }

    const indent = Math.max(1, Math.floor(Number(cell(row, indentColumn))) || 1);
    const key = `${prefix}:${batch.tasks.length + 1}`;
    // The parent is the nearest earlier task one level up (a jump in
    // indentation just attaches to the closest ancestor).
    stack.length = Math.min(stack.length, indent - 1);
    const parentKey = stack[stack.length - 1] ?? null;
    stack.push(key);

    const dateText = cell(row, dateColumn);
    const deadlineText = cell(row, deadlineColumn);
    let dueDate: string | null = null;
    let dueTime: string | null = null;
    let recurrence = null;
    const notes: string[] = [];
    if (dateText) {
      if (looksRecurring(dateText)) {
        recurrence = toRecurrence(dateText);
        if (!recurrence) notes.push(`Repeats: ${dateText}`);
      } else {
        const parsed = parseLooseDate(dateText, options);
        if (parsed) {
          dueDate = parsed.date;
          dueTime = parsed.time;
        } else {
          unreadDates += 1;
          notes.push(`Date: ${dateText}`);
        }
      }
    }
    if (deadlineText) {
      const deadline = parseLooseDate(deadlineText, options);
      if (deadline && !dueDate) {
        dueDate = deadline.date;
      } else if (deadline && deadline.date !== dueDate) {
        notes.push(`Deadline: ${deadline.date}`);
      } else if (!deadline) {
        notes.push(`Deadline: ${deadlineText}`);
      }
    }
    const responsible = cell(row, responsibleColumn);
    if (responsible) notes.push(`Assigned to: ${responsible}`);

    const task = makeTask(key, content, {
      description: [cell(row, descriptionColumn), ...notes].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION_LENGTH),
      priority: priorityFrom(cell(row, priorityColumn)),
      dueDate,
      dueTime,
      recurrence,
      parentKey,
      projectName: project,
      status: DOING.test(section) ? "in_progress" : "next",
      estimatedMinutes: durationMinutes(cell(row, durationColumn), cell(row, durationUnitColumn)),
    });
    batch.tasks.push(task);
    lastTask = task;
  }
  if (unreadDates > 0) batch.warnings.push({ code: "dates", count: unreadDates, file: options.fileName });
  collectProjects(batch);
  return batch;
}
