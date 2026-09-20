import type { CalendarEvent } from "./calendar";
import { dateKey } from "./calendar";
import { validateCalendarEvent } from "./calendarEvents";
import { draftWithAgent, getAgentSettings } from "./ai";
import { getToken } from "./auth";

export function parseCalendarDraft(raw: string, base: CalendarEvent): CalendarEvent {
  const value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
  if (!value || typeof value !== "object" || typeof value.title !== "string" || typeof value.date !== "string") throw new Error("Invalid draft");
  for (const field of ["endDate", "description", "location"] as const) if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("Invalid draft");
  for (const field of ["startTime", "endTime"] as const) if (value[field] !== null && typeof value[field] !== "string") throw new Error("Invalid draft");
  if (value.recurrence && (typeof value.recurrence !== "object" || (value.recurrence.weekdays !== undefined && !Array.isArray(value.recurrence.weekdays)))) throw new Error("Invalid draft");
  const draft: CalendarEvent = { ...base, title: value.title.slice(0, 300), date: value.date, endDate: value.endDate || value.date,
    startTime: value.startTime, endTime: value.endTime, description: value.description?.slice(0, 10000) ?? "", location: value.location?.slice(0, 1000) ?? "",
    recurrence: value.recurrence || undefined };
  if (validateCalendarEvent(draft)) throw new Error("Invalid draft");
  return draft;
}

export async function draftCalendarEvent(prompt: string, base: CalendarEvent, signal: AbortSignal): Promise<CalendarEvent> {
  const system = `Prepare ONE calendar event draft, never execute actions. Return only JSON with title, date (YYYY-MM-DD), endDate (inclusive, YYYY-MM-DD), startTime and endTime (HH:mm or both null for all day), description, location, optional recurrence: {frequency: daily|weekly|monthly|yearly, interval: integer 1..365, weekdays: Sunday=0 through Saturday=6 array (required for weekly), until?: YYYY-MM-DD, count?: integer 1..10000}. Never invent attendees, confirmations or reminders. Today is ${dateKey()}. Selected date is ${base.date}. Device timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Preserve the user's language. If duration is omitted use one hour. Monthly repeats skip months without the selected day. Do not include markdown.`;
  const raw = await draftWithAgent(system, prompt, getAgentSettings(), await getToken(), signal);
  signal.throwIfAborted();
  return parseCalendarDraft(raw, base);
}
