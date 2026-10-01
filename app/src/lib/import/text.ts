import { parseTaskTitle } from "../taskTitleParser";
import type { TaskPriority, TaskStatus } from "../../types";
import { collectProjects, emptyBatch, makeTask, MAX_IMPORT_TASKS, type ImportBatch, type ImportedTask } from "./types";

type TextOptions = { today?: Date; lang?: string };

const LIST_LINE = /^(\s*)(?:[-*•+–]|\d+[.)])\s+(?:\[([ xX✓✔])\]\s*)?(.*)$/;
const CHECK_LINE = /^(\s*)\[([ xX✓✔])\]\s*(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

function indentWidth(whitespace: string): number {
  return [...whitespace].reduce((total, char) => total + (char === "\t" ? 4 : 1), 0);
}

/**
 * A pasted list, one task per line, without AI: bullets, numbers and
 * "[ ]" / "[x]" boxes are dropped (checked means done), indentation makes
 * sub-tasks, "# Heading" lines start a project, and what quick add
 * understands ("tomorrow", "p1", "Friday 3pm", "demain") fills the dates and
 * priority.
 */
export function parseTextList(text: string, options: TextOptions = {}): ImportBatch {
  const batch = emptyBatch("text");
  const stack: Array<{ width: number; key: string }> = [];
  let project: string | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      project = heading[1].trim() || null;
      stack.length = 0;
      continue;
    }
    let indent = 0;
    let body = line.trim();
    let checked = false;
    const list = LIST_LINE.exec(line);
    const check = CHECK_LINE.exec(line);
    if (list) {
      indent = indentWidth(list[1]);
      checked = /[xX✓✔]/.test(list[2] ?? "");
      body = list[3].trim();
    } else if (check) {
      indent = indentWidth(check[1]);
      checked = /[xX✓✔]/.test(check[2]);
      body = check[3].trim();
    } else {
      indent = indentWidth(/^\s*/.exec(line)?.[0] ?? "");
    }
    if (!body) continue;
    if (batch.tasks.length >= MAX_IMPORT_TASKS) {
      batch.warnings.push({ code: "truncated", count: MAX_IMPORT_TASKS });
      break;
    }
    while (stack.length > 0 && stack[stack.length - 1].width >= indent) stack.pop();
    const parentKey = stack[stack.length - 1]?.key ?? null;

    const parsed = parseTaskTitle(body, { now: options.today, lang: options.lang });
    const fields = parsed.fields;
    const priority = typeof fields.priority === "number" && fields.priority >= 1 && fields.priority <= 4 ? (fields.priority as TaskPriority) : 4;
    const title = parsed.cleanTitle.trim() || body;
    const task: ImportedTask = makeTask(`text:${batch.tasks.length + 1}`, title, {
      priority,
      important: typeof fields.important === "boolean" ? fields.important : priority <= 2,
      urgent: typeof fields.urgent === "boolean" ? fields.urgent : priority === 1,
      dueDate: typeof fields.dueDate === "string" ? fields.dueDate : null,
      dueTime: typeof fields.dueTime === "string" ? fields.dueTime : null,
      status: (typeof fields.status === "string" ? fields.status : "next") as TaskStatus,
      state: checked ? "completed" : "open",
      parentKey,
      projectName: project,
    });
    if (checked) task.status = "done";
    batch.tasks.push(task);
    stack.push({ width: indent, key: task.key });
  }
  collectProjects(batch);
  return batch;
}
