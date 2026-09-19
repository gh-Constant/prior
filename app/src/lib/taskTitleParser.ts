import type { Area, Project, TaskDraft, TaskStatus } from "../types";

export type TaskTitleField = "dueDate" | "dueTime" | "priority" | "status" | "projectId" | "areaId" | "assigneeName" | "important" | "urgent";

export type TaskTitleToken = {
  key: string;
  field: TaskTitleField;
  raw: string;
  start: number;
  end: number;
  value: string | number | boolean;
  label: string;
};

export type ParsedTaskTitle = {
  cleanTitle: string;
  tokens: TaskTitleToken[];
  fields: Partial<Record<TaskTitleField, string | number | boolean>>;
};

export type TaskTitleParserContext = {
  readonly projects?: readonly Pick<Project, "id" | "name">[];
  readonly areas?: readonly Pick<Area, "id" | "name">[];
  readonly now?: Date;
  readonly lang?: string;
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  dimanche: 0, dim: 0, lundi: 1, lun: 1, mardi: 2, mar: 2, mercredi: 3, mer: 3,
  jeudi: 4, jeu: 4, vendredi: 5, ven: 5, samedi: 6, sam: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, october: 10,
  oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};

const FIELD_LABELS: Record<TaskTitleField, string> = {
  dueDate: "Due date", dueTime: "Time", priority: "Priority", status: "Status", projectId: "Project",
  areaId: "Area", assigneeName: "Responsible", important: "Important", urgent: "Urgent",
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function normalizeTime(hour: number, minute: number, meridiem?: string): string | null {
  let normalizedHour = hour;
  if (meridiem?.toLowerCase() === "pm" && normalizedHour < 12) normalizedHour += 12;
  if (meridiem?.toLowerCase() === "am" && normalizedHour === 12) normalizedHour = 0;
  return normalizedHour >= 0 && normalizedHour <= 23 && minute >= 0 && minute <= 59
    ? `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localizedDateLabel(value: string, lang: string): string {
  const [year, month, day] = value.split("-").map(Number);
  let formatter = dateFormatters.get(lang);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
    dateFormatters.set(lang, formatter);
  }
  return formatter.format(new Date(year, month - 1, day));
}

function localizedTimeLabel(value: string): string {
  return value;
}

function fieldLabel(field: TaskTitleField, value: string | number | boolean, lang: string): string {
  if (field === "dueDate") return `${FIELD_LABELS[field]} · ${localizedDateLabel(String(value), lang)}`;
  if (field === "dueTime") return `${FIELD_LABELS[field]} · ${localizedTimeLabel(String(value))}`;
  if (field === "priority") return `${FIELD_LABELS[field]} · P${value}`;
  if (field === "status") return `${FIELD_LABELS[field]} · ${String(value).replace("_", " ")}`;
  if (field === "important" || field === "urgent") return FIELD_LABELS[field];
  return `${FIELD_LABELS[field]} · ${String(value)}`;
}

function makeCandidate(field: TaskTitleField, raw: string, start: number, value: string | number | boolean, lang: string, labelValue = value): TaskTitleToken {
  return { key: `${field}:${start}:${raw.toLocaleLowerCase()}`, field, raw, start, end: start + raw.length, value, label: fieldLabel(field, labelValue, lang) };
}

function parseDateWords(title: string, now: Date, lang: string): TaskTitleToken[] {
  const result: TaskTitleToken[] = [];
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(now, 1));
  const relative = /\b(today|tomorrow|aujourd['’]hui|demain)\b/gi;
  for (const match of title.matchAll(relative)) {
    const raw = match[0];
    const value = /tomorrow|demain/i.test(raw) ? tomorrow : today;
    result.push(makeCandidate("dueDate", raw, match.index ?? 0, value, lang));
  }

  const weekdayPattern = /\b(?:(next|prochain(?:e)?)\s+)?(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|dimanche|dim|lundi|lun|mardi|mar|mercredi|mer|jeudi|jeu|vendredi|ven|samedi|sam)\b/gi;
  for (const match of title.matchAll(weekdayPattern)) {
    const weekday = WEEKDAYS[match[2].toLowerCase()];
    if (weekday === undefined) continue;
    const forceNext = Boolean(match[1]);
    let distance = (weekday - now.getDay() + 7) % 7;
    if (forceNext && distance === 0) distance = 7;
    const value = dateKey(addDays(now, distance));
    result.push(makeCandidate("dueDate", match[0], match.index ?? 0, value, lang));
  }

  const numericDate = /\b(?:(?:on|le)\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?\b/gi;
  for (const match of title.matchAll(numericDate)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3] ?? now.getFullYear());
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) continue;
    result.push(makeCandidate("dueDate", match[0], match.index ?? 0, dateKey(parsed), lang));
  }

  const isoDate = /\b\d{4}-\d{2}-\d{2}\b/g;
  for (const match of title.matchAll(isoDate)) {
    const parsed = new Date(`${match[0]}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) result.push(makeCandidate("dueDate", match[0], match.index ?? 0, match[0], lang));
  }

  const namedDate = /\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?\b/gi;
  for (const match of title.matchAll(namedDate)) {
    const month = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3] ?? now.getFullYear());
    const day = Number(match[1]);
    const parsed = new Date(year, month - 1, day);
    if (month && parsed.getMonth() === month - 1 && parsed.getDate() === day) result.push(makeCandidate("dueDate", match[0], match.index ?? 0, dateKey(parsed), lang));
  }
  return result;
}

function parseTimes(title: string, lang: string): TaskTitleToken[] {
  const result: TaskTitleToken[] = [];
  const prefixed = /(?:^|\s)(?:at|à|a)\s+(\d{1,2})(?:(?::|h)(\d{2}))?\s*(am|pm)?\b/giu;
  for (const match of title.matchAll(prefixed)) {
    const raw = match[0].trimStart();
    const start = (match.index ?? 0) + (match[0].length - raw.length);
    const value = normalizeTime(Number(match[1]), Number(match[2] ?? 0), match[3]);
    if (value) result.push(makeCandidate("dueTime", raw, start, value, lang));
  }
  const clock = /(?<![\p{L}\d])(\d{1,2})(?::|h)(\d{2})(?![\p{L}\d])/giu;
  for (const match of title.matchAll(clock)) {
    const value = normalizeTime(Number(match[1]), Number(match[2] ?? 0), undefined);
    if (value) result.push(makeCandidate("dueTime", match[0], match.index ?? 0, value, lang));
  }
  const meridiem = /(?<![\p{L}\d])(\d{1,2})\s*(am|pm)(?![\p{L}\d])/giu;
  for (const match of title.matchAll(meridiem)) {
    const value = normalizeTime(Number(match[1]), 0, match[2]);
    if (value) result.push(makeCandidate("dueTime", match[0], match.index ?? 0, value, lang));
  }
  return result;
}

function parseExplicitFields(title: string, context: TaskTitleParserContext, lang: string): TaskTitleToken[] {
  const result: TaskTitleToken[] = [];
  const addSimple = (pattern: RegExp, field: TaskTitleField, valueFrom: (match: RegExpMatchArray) => string | number | boolean, labelValue?: (match: RegExpMatchArray) => string | number | boolean) => {
    for (const match of title.matchAll(pattern)) {
      const raw = match[0];
      const value = valueFrom(match);
      result.push(makeCandidate(field, raw, match.index ?? 0, value, lang, labelValue?.(match) ?? value));
    }
  };

  addSimple(/\b(?:priority|prio|priorité)\s*:?\s*p?([1-4])\b/gi, "priority", (match) => Number(match[1]));
  addSimple(/(?<![\p{L}])[pP]([1-4])\b/gu, "priority", (match) => Number(match[1]));
  addSimple(/\b(?:status|état)\s*:\s*(inbox|backlog|next|todo|in.progress|waiting|en.attente|done|terminé)\b/gi, "status", (match) => {
    const value = match[1].toLowerCase();
    if (value === "todo") return "next";
    if (value === "en.attente") return "waiting";
    if (value === "terminé") return "done";
    return value.replace(".", "_") as TaskStatus;
  });
  addSimple(/!important\b/gi, "important", () => true);
  addSimple(/!urgent\b/gi, "urgent", () => true);

  const named = (field: "projectId" | "areaId", prefixes: string[], items: readonly { id: string; name: string }[]) => {
    for (const item of [...items].sort((left, right) => right.name.length - left.name.length)) {
      const prefix = prefixes.join("|");
      const pattern = new RegExp(`\\b(?:${prefix})\\s*:\\s*${escapeRegExp(item.name)}(?=\\s|$|[,;])`, "gi");
      addSimple(pattern, field, () => item.id, () => item.name);
    }
  };
  named("projectId", ["project", "projet"], context.projects ?? []);
  named("areaId", ["area", "espace"], context.areas ?? []);
  addSimple(/\b(?:responsible|assignee|for|pour)\s*:\s*([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)(?=\s|$|[,;])/giu, "assigneeName", (match) => match[1], (match) => match[1]);
  return result;
}

export function parseTaskTitle(title: string, context: TaskTitleParserContext = {}, ignoredKeys: readonly string[] = []): ParsedTaskTitle {
  const lang = context.lang ?? "en-US";
  const now = context.now ?? new Date();
  const candidates = [...parseDateWords(title, now, lang), ...parseTimes(title, lang), ...parseExplicitFields(title, context, lang)]
    .filter((token, index, all) => !ignoredKeys.includes(token.key) && all.findIndex((other) => other.key === token.key) === index)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const tokens: TaskTitleToken[] = [];
  for (const candidate of candidates) {
    if (tokens.some((token) => candidate.start < token.end && candidate.end > token.start)) continue;
    tokens.push(candidate);
  }
  tokens.sort((left, right) => left.start - right.start);
  const fields: Partial<Record<TaskTitleField, string | number | boolean>> = {};
  for (const token of tokens) fields[token.field] = token.value;
  let cursor = 0;
  const parts: string[] = [];
  for (const token of tokens) {
    parts.push(title.slice(cursor, token.start));
    cursor = token.end;
  }
  parts.push(title.slice(cursor));
  const cleanTitle = parts.join(" ").replace(/[ \t]+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
  return { cleanTitle, tokens, fields };
}

export function taskTitleTokenFieldValue(token: TaskTitleToken): Partial<TaskDraft> {
  return { [token.field]: token.value } as Partial<TaskDraft>;
}

export { FIELD_LABELS };
