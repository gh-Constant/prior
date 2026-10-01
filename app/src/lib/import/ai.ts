import { api, apiErrorCode, isRateLimitedError } from "../api";
import { getToken } from "../auth";
import { parseAll, parseAnalyzed, type AnalyzedFile, type ParseSettings } from "./analyze";
import { dateToIso } from "./dates";
import { toRecurrence } from "./recurrence";
import { collectProjects, emptyBatch, flagsForPriority, makeTask, mergeBatches, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, type ImportBatch, type ImportedTask, type ImportWarning } from "./types";
import type { TaskPriority } from "../../types";

/**
 * AI import ("Organise with Prior AI", paid plans). Nothing here is needed to
 * import: the deterministic readers work without it. The model only
 *  - reads pasted free text and files no reader recognises, and
 *  - cleans up what a reader found: splits "title — details", infers priority
 *    and dates written in words, and suggests projects for loose tasks.
 * Every answer is validated and clamped before it reaches the preview, and
 * nothing is saved until the user confirms there.
 */

export type AiAccess = "checking" | "signed-out" | "locked" | "unavailable" | "ready";

/** Whether this account can run AI import. The API enforces the same rule on every request. */
export async function loadAiAccess(): Promise<AiAccess> {
  const token = await getToken().catch(() => null);
  if (!token) return "signed-out";
  try {
    const status = await api.hostedAiStatus(token);
    if (status.entitlement && !status.entitlement.allowed) return "locked";
    return status.available ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Largest request, in characters of input, and the most requests one import may send. */
export const AI_CHUNK_CHARS = 12_000;
export const AI_MAX_REQUESTS = 10;
export const AI_MAX_TASKS = 2000;
const MAX_PROJECT_NAME = 60;

export class ImportAiError extends Error {
  constructor(public readonly reason: "plan" | "quota" | "failed", message: string) {
    super(message);
    this.name = "ImportAiError";
  }
}

export type AiProgress = { done: number; total: number };

export type AiImportInput = {
  files: readonly AnalyzedFile[];
  settings: ParseSettings;
  /** Names of the user's projects, so loose tasks can be filed in them. */
  existingProjects: readonly string[];
  onProgress?: (progress: AiProgress) => void;
  signal?: AbortSignal;
};

export type AiImportResult = {
  batch: ImportBatch;
  /** How many requests were sent. */
  requests: number;
  warnings: ImportWarning[];
  /** Set when the API refused (no plan, or the Prior AI limit); the rest was read without AI. */
  stopped: "plan" | "quota" | null;
};

/* ── Prompts ── */

const SHARED_RULES = [
  "You help import tasks into a personal task manager. Answer with ONE JSON object only (no markdown, no code fences).",
  "Keep every text in the language it is written in; never translate. Never invent tasks, people or facts.",
  'Priority is 1 (urgent) to 4 (none). "important" and "urgent" are booleans for the Eisenhower matrix; do not mark everything important.',
  "Dates are ISO YYYY-MM-DD, resolved from the given today's date; null when unknown. Titles are at most 200 characters.",
].join("\n");

export function cleanupSystemPrompt(today: string, projects: readonly string[]): string {
  return [
    SHARED_RULES,
    `Today is ${today}.`,
    "The user message is JSON lines, one task per line: i (index), t (title), d (start of the description), due, p (priority), proj (project or null).",
    'Return {"tasks":[{"i":<index>,"title":string,"extra":string,"dueDate":string|null,"priority":1-4,"important":boolean,"urgent":boolean,"project":string|null,"repeats":string|null}]} with one entry per input line, same i.',
    '- "title": the cleaned title. If it is really "title - details" or has trailing noise, keep the action and move the rest to "extra". Otherwise return it unchanged.',
    '- "extra": details moved out of the title, else "".',
    '- "dueDate": only when due is null and the title or description states a date or deadline in words; otherwise return due unchanged.',
    '- "priority": return p unchanged unless p is 4 and the text clearly shows urgency or importance.',
    '- "project": only when proj is null: one of the existing projects below, or a short new name shared by several related tasks; null when unsure.',
    '- "repeats": the repeat phrase exactly as written (e.g. "every monday", "tous les jours") when the text says the task repeats, else null.',
    projects.length > 0 ? `Existing projects: ${projects.slice(0, 40).map((name) => JSON.stringify(name)).join(", ")}.` : "There are no existing projects.",
  ].join("\n");
}

export function extractSystemPrompt(today: string, projects: readonly string[]): string {
  return [
    SHARED_RULES,
    `Today is ${today}.`,
    "The user message is a to-do list, notes, or a table exported from another tool. Extract its tasks.",
    'Return {"tasks":[{"title":string,"description":string,"dueDate":string|null,"priority":1-4,"important":boolean,"urgent":boolean,"project":string|null,"parent":number|null,"done":boolean,"repeats":string|null}]}.',
    '- One entry per actionable task, in the original order. Skip headings, empty lines and commentary that are not tasks.',
    '- "parent": the 0-based index (in your own list) of the parent task when this one is a sub-task, else null.',
    '- "project": a project or list name the text puts the task under, or one of the existing projects below; null otherwise.',
    '- "done": true only when the text marks the task as finished (checked box, "done", strikethrough).',
    '- "description": short useful context from the text, else "".',
    projects.length > 0 ? `Existing projects: ${projects.slice(0, 40).map((name) => JSON.stringify(name)).join(", ")}.` : "There are no existing projects.",
  ].join("\n");
}

/* ── Chunking ── */

/** Splits lines into chunks of at most `limit` characters (a longer line is cut). */
export function chunkLines(lines: readonly string[], limit = AI_CHUNK_CHARS, header = ""): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = header.length;
  for (const original of lines) {
    const line = original.length > limit ? original.slice(0, limit) : original;
    if (current.length > 0 && size + line.length + 1 > limit) {
      chunks.push(current);
      current = [];
      size = header.length;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/* ── Model I/O ── */

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function requestJson(system: string, prompt: string, token: string): Promise<Record<string, unknown>> {
  try {
    const response = await api.agentComplete({ model: "", prompt, system, history: [], webSearch: false, purpose: "import", provider: "hosted", json: true }, token);
    const parsed = parseJsonObject(response.content);
    if (!parsed) throw new ImportAiError("failed", "The assistant did not return a readable answer.");
    return parsed;
  } catch (error) {
    if (error instanceof ImportAiError) throw error;
    if (apiErrorCode(error) === "HOSTED_AI_REQUIRES_PLAN") throw new ImportAiError("plan", "AI import is included in Pro.");
    if (isRateLimitedError(error) || apiErrorCode(error) === "HOSTED_AI_QUOTA") throw new ImportAiError("quota", "The Prior AI limit was reached.");
    throw new ImportAiError("failed", error instanceof Error ? error.message : "The assistant request failed.");
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return value.trim();
}

function priorityOf(value: unknown): TaskPriority | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function entries(response: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = response.tasks;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function withRepeat(task: ImportedTask, phrase: string | null): void {
  if (!phrase) return;
  const recurrence = toRecurrence(phrase);
  if (recurrence) task.recurrence = recurrence;
  else if (!task.description.includes(phrase)) task.description = [task.description, `Repeats: ${phrase}`].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION_LENGTH);
}

/** Lays the model's cleanup of one chunk over the tasks it was about. */
export function applyCleanup(tasks: readonly ImportedTask[], response: Record<string, unknown>): number {
  let changed = 0;
  for (const item of entries(response)) {
    const index = typeof item.i === "number" && Number.isInteger(item.i) ? item.i : -1;
    const task = tasks[index];
    if (!task) continue;
    const before = JSON.stringify(task);
    const title = text(item.title, MAX_TITLE_LENGTH);
    if (title) task.title = title;
    const extra = text(item.extra, MAX_DESCRIPTION_LENGTH);
    if (extra && !task.description.includes(extra)) task.description = [extra, task.description].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION_LENGTH);
    if (!task.dueDate) {
      const due = isoDate(item.dueDate);
      if (due) task.dueDate = due;
    }
    const priority = priorityOf(item.priority);
    if (priority && task.priority === 4 && priority < 4) {
      task.priority = priority;
      const flags = flagsForPriority(priority);
      task.important = typeof item.important === "boolean" ? item.important : flags.important;
      task.urgent = typeof item.urgent === "boolean" ? item.urgent : flags.urgent;
    }
    if (!task.projectName) {
      const project = text(item.project, MAX_PROJECT_NAME);
      if (project) task.projectName = project;
    }
    withRepeat(task, text(item.repeats, 80));
    if (JSON.stringify(task) !== before) changed += 1;
  }
  return changed;
}

/** Builds tasks from the model's extraction of one chunk of free text. */
export function tasksFromExtraction(response: Record<string, unknown>, keyPrefix: string): ImportedTask[] {
  const tasks: ImportedTask[] = [];
  const parentIndexes: Array<number | null> = [];
  for (const item of entries(response)) {
    const title = text(item.title, MAX_TITLE_LENGTH);
    if (!title) continue;
    const priority = priorityOf(item.priority) ?? 4;
    const flags = flagsForPriority(priority);
    const done = item.done === true;
    const task = makeTask(`${keyPrefix}:${tasks.length + 1}`, title, {
      description: text(item.description, MAX_DESCRIPTION_LENGTH) ?? "",
      dueDate: isoDate(item.dueDate),
      priority,
      important: typeof item.important === "boolean" ? item.important : flags.important,
      urgent: typeof item.urgent === "boolean" ? item.urgent : flags.urgent,
      status: done ? "done" : "next",
      state: done ? "completed" : "open",
      projectName: text(item.project, MAX_PROJECT_NAME),
    });
    withRepeat(task, text(item.repeats, 80));
    tasks.push(task);
    parentIndexes.push(typeof item.parent === "number" && Number.isInteger(item.parent) ? item.parent : null);
  }
  // The model numbers sub-tasks by position in its own list; keep only parents that exist, earlier, in the same project.
  tasks.forEach((task, position) => {
    const parent = parentIndexes[position];
    if (parent === null || parent < 0 || parent >= position) return;
    if ((tasks[parent].projectName ?? null) === (task.projectName ?? null)) task.parentKey = tasks[parent].key;
  });
  return tasks;
}

/* ── The import ── */

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}

type RawJob = { file: AnalyzedFile; chunks: string[] };

/** Free text and unrecognised tables, cut into requests (a table keeps its header row in each). */
function planRawJobs(files: readonly AnalyzedFile[]): RawJob[] {
  return files.map((file) => {
    const lines = file.file.text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim() !== "");
    const header = file.kind === "text" ? "" : lines[0] ?? "";
    const body = file.kind === "text" ? lines : lines.slice(1);
    return { file, chunks: chunkLines(body, AI_CHUNK_CHARS, header).map((chunk) => (header ? [header, ...chunk] : chunk).join("\n")) };
  });
}

/**
 * Runs the AI over the analyzed files. Files that need the model (free text,
 * tables with no recognisable title column) are read by it; the others are
 * read by their deterministic reader first and then cleaned up. A request
 * that fails leaves its part as the deterministic reader found it; a plan or
 * quota refusal stops the AI (`stopped`) and keeps what was already done.
 */
export async function organiseWithAi(input: AiImportInput): Promise<AiImportResult> {
  const token = await getToken().catch(() => null);
  if (!token) throw new ImportAiError("failed", "Sign in to use Prior AI.");
  const today = dateToIso(input.settings.today ?? new Date());
  const warnings: ImportWarning[] = [];
  const state: { stopped: AiImportResult["stopped"]; requests: number; done: number } = { stopped: null, requests: 0, done: 0 };

  // Plan the requests up front so progress is honest and the budget is respected.
  const rawJobs = planRawJobs(input.files.filter((file) => file.unrecognised));
  const known = input.files.filter((file) => !file.unrecognised);
  let budget = AI_MAX_REQUESTS;
  const aiJobs = new Set<RawJob>();
  for (const job of rawJobs) {
    if (job.chunks.length > 0 && job.chunks.length <= budget) {
      aiJobs.add(job);
      budget -= job.chunks.length;
    } else if (job.chunks.length > 0) {
      warnings.push({ code: "aiTooLong", file: job.file.file.name });
    }
  }
  const knownBatch = known.length > 0 ? parseAll(known, input.settings) : emptyBatch("csv");
  const rowChunks = chunkLines(knownBatch.tasks.map((task, index) => JSON.stringify({ i: index, t: task.title, d: task.description.slice(0, 200), due: task.dueDate, p: task.priority, proj: task.projectName })));
  const cleanupChunks = rowChunks.slice(0, budget);
  if (rowChunks.length > cleanupChunks.length) warnings.push({ code: "aiRows" });
  const total = [...aiJobs].reduce((sum, job) => sum + job.chunks.length, 0) + cleanupChunks.length;
  input.onProgress?.({ done: 0, total });

  const send = async (system: string, prompt: string): Promise<Record<string, unknown> | null> => {
    throwIfAborted(input.signal);
    state.requests += 1;
    try {
      return await requestJson(system, prompt, token);
    } catch (error) {
      if (error instanceof ImportAiError && error.reason !== "failed") state.stopped = error.reason;
      else warnings.push({ code: "aiPartial" });
      return null;
    } finally {
      state.done += 1;
      input.onProgress?.({ done: state.done, total });
    }
  };

  const batches: ImportBatch[] = [];
  const extractSystem = extractSystemPrompt(today, input.existingProjects);
  let jobNumber = 0;
  for (const job of rawJobs) {
    jobNumber += 1;
    if (job.chunks.length === 0) continue;
    let extracted: ImportedTask[] | null = null;
    if (aiJobs.has(job) && !state.stopped) {
      extracted = [];
      for (const [index, chunk] of job.chunks.entries()) {
        const response = state.stopped ? null : await send(extractSystem, chunk);
        if (!response) {
          extracted = null;
          break;
        }
        extracted.push(...tasksFromExtraction(response, `ai${jobNumber}:${index + 1}`));
      }
    }
    if (!extracted) {
      batches.push(parseAnalyzed(job.file, input.settings));
      continue;
    }
    const batch = emptyBatch("text");
    batch.tasks = extracted.slice(0, AI_MAX_TASKS);
    if (extracted.length > AI_MAX_TASKS) batch.warnings.push({ code: "aiKept", count: AI_MAX_TASKS });
    collectProjects(batch);
    batches.push(batch);
  }

  if (known.length > 0) {
    const cleanupSystem = cleanupSystemPrompt(today, input.existingProjects);
    for (const chunk of cleanupChunks) {
      if (state.stopped) break;
      const response = await send(cleanupSystem, chunk.join("\n"));
      if (response) applyCleanup(knownBatch.tasks, response);
    }
    // Projects the model suggested for loose tasks; the readers' own (software, areas) are kept.
    collectProjects(knownBatch);
    batches.push(knownBatch);
  }

  const merged = batches.length > 0 ? mergeBatches(batches) : emptyBatch("text");
  merged.source = known.length > 0 ? knownBatch.source : "text";
  merged.warnings.push(...warnings);
  return { batch: merged, requests: state.requests, warnings, stopped: state.stopped };
}

