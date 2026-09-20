import ICAL from "ical.js";
import type { CalendarEvent } from "./calendar";
import { addDays, dateKey, timeFromMinutes } from "./calendar";

function calendarDate(time: ICAL.Time, event: ICAL.Event, property: "dtstart" | "dtend"): Date {
  const tzid = event.component.getFirstProperty(property)?.getParameter("tzid") ?? event.component.getFirstProperty("dtstart")?.getParameter("tzid");
  if (time.isDate || !tzid || time.zone.tzid !== "floating") return time.toJSDate();
  // Many feeds use an IANA TZID without embedding VTIMEZONE. Resolve those
  // using the runtime timezone database, rather than treating them as local.
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: String(tzid), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const civil = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  let instant = civil;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const correction = civil - represented;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}

/** Bound expansion of untrusted feeds; never silently save a truncated import. */
export function parseIcsCalendar(value: string, sourceId: string, color: string, reference = new Date(), range?: { from: Date; to: Date }): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(value)) throw new Error("Invalid ICS calendar");
  const root = new ICAL.Component(ICAL.parse(value));
  const events = root.getAllSubcomponents("vevent").map((component) => new ICAL.Event(component));
  const cancelled = new Set(events.filter((event) => event.isRecurrenceException() && event.component.getFirstPropertyValue("status") === "CANCELLED").flatMap((event) => [
    `${event.uid}/${event.recurrenceId.toString()}`, `${event.uid}/${event.recurrenceId.convertToZone(ICAL.Timezone.utcTimezone).toString()}`,
  ]));
  const result: CalendarEvent[] = [];
  const from = range?.from ?? addDays(reference, -366);
  const to = range ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59) : addDays(reference, 366 * 3);
  let iterations = 0;
  for (const event of events) {
    if (event.isRecurrenceException()) continue;
    if (!event.component.hasProperty("dtstart")) continue;
    if (event.component.getFirstPropertyValue("status") === "CANCELLED") continue;
    const horizon = new Date(Math.max(to.getTime(), ...events.filter((item) => item.uid === event.uid && item.isRecurrenceException()).map((item) => item.recurrenceId.toJSDate().getTime())));
    const iterator = event.iterator();
    let occurrence;
    while ((occurrence = iterator.next())) {
      if (++iterations > 100000 || result.length > 20000) throw new Error("Calendar recurrence limit exceeded");
      if (event.isRecurring() && calendarDate(occurrence, event, "dtstart") > horizon) break;
      if (cancelled.has(`${event.uid}/${occurrence.toString()}`) || cancelled.has(`${event.uid}/${occurrence.convertToZone(ICAL.Timezone.utcTimezone).toString()}`)) continue;
      const detail = event.getOccurrenceDetails(occurrence);
      if (detail.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
      const start = calendarDate(detail.startDate, detail.item, "dtstart");
      const end = calendarDate(detail.endDate, detail.item, "dtend");
      if (event.isRecurring() && start > to) continue;
      if (event.isRecurring() && end < from) continue;
      const allDay = detail.startDate.isDate;
      // Stored all-day end dates are inclusive; RFC 5545 DTEND is exclusive.
      const endDay = allDay && end > start ? addDays(end, -1) : end;
      result.push({
        id: `${sourceId}-${event.uid || events.indexOf(event)}${event.isRecurring() ? `-${occurrence.toString()}` : ""}`,
        sourceId, title: detail.item.summary || "Untitled", date: dateKey(start), endDate: dateKey(endDay),
        startTime: allDay ? null : timeFromMinutes(start.getHours() * 60 + start.getMinutes()),
        endTime: allDay ? null : timeFromMinutes(end.getHours() * 60 + end.getMinutes()),
        color, location: detail.item.location, description: detail.item.description, kind: "event",
      });
      if (!event.isRecurring()) break;
    }
  }
  return result;
}
