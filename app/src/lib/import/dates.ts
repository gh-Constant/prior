/**
 * Reads the dates found in exports: ISO, "October 3, 2026", "3 oct 2026",
 * "03/10/2026", Notion ranges ("A → B"), times, and the relative words
 * Todoist keeps ("tomorrow", "demain", "monday"). English, French, German,
 * Spanish and Portuguese month and weekday names are understood.
 */

export type DayOrder = "dmy" | "mdy";

export type LooseDate = { date: string; time: string | null };

type Options = {
  /** How to read 03/10/2026 when both numbers could be a month. Default: dmy. */
  order?: DayOrder;
  /** "Today" for relative words and years left out. Default: now. */
  today?: Date;
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janv: 1, janvier: 1, januar: 1, enero: 1, ene: 1, janeiro: 1,
  february: 2, feb: 2, fevrier: 2, fev: 2, fevr: 2, februar: 2, febrero: 2, fevereiro: 2,
  march: 3, mar: 3, mars: 3, marz: 3, mrz: 3, marzo: 3, marco: 3,
  april: 4, apr: 4, avril: 4, avr: 4, abril: 4, abr: 4,
  may: 5, mai: 5, mayo: 5, maio: 5,
  june: 6, jun: 6, juin: 6, juni: 6, junio: 6, junho: 6,
  july: 7, jul: 7, juillet: 7, juil: 7, juli: 7, julio: 7, julho: 7,
  august: 8, aug: 8, aout: 8, ago: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, septembre: 9, septiembre: 9, setiembre: 9, set: 9, setembro: 9,
  october: 10, oct: 10, octobre: 10, oktober: 10, okt: 10, octubre: 10, out: 10, outubro: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11, novembro: 11,
  december: 12, dec: 12, decembre: 12, dezember: 12, dez: 12, diciembre: 12, dic: 12, dezembro: 12,
};

/** JS weekday numbers (0 = Sunday) for names in the five languages. */
export const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, dimanche: 0, sonntag: 0, domingo: 0,
  monday: 1, mon: 1, lundi: 1, montag: 1, lunes: 1, segunda: 1,
  tuesday: 2, tue: 2, tues: 2, mardi: 2, dienstag: 2, martes: 2, terca: 2,
  wednesday: 3, wed: 3, mercredi: 3, mittwoch: 3, miercoles: 3, quarta: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, jeudi: 4, donnerstag: 4, jueves: 4, quinta: 4,
  friday: 5, fri: 5, vendredi: 5, freitag: 5, viernes: 5, sexta: 5,
  saturday: 6, sat: 6, samedi: 6, samstag: 6, sabado: 6,
};

const RELATIVE_DAYS: Record<string, number> = {
  today: 0, tonight: 0, aujourdhui: 0, heute: 0, hoy: 0, hoje: 0,
  tomorrow: 1, demain: 1, morgen: 1, manana: 1, amanha: 1,
  yesterday: -1, hier: -1, gestern: -1, ayer: -1, ontem: -1,
};

const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function twoDigitYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** Removes a time of day from the text and returns it as HH:mm. */
function extractTime(text: string): { rest: string; time: string | null } {
  const clock = /(?:^|[\st@])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(a\.?m\.?|p\.?m\.?)?(?=$|[\sz,+-])/.exec(text);
  const hour12 = /(?:^|[\s@])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?=$|[\s,])/.exec(text);
  const french = /(?:^|[\s@])(\d{1,2})\s*h\s*(\d{2})?(?=$|[\s,])/.exec(text);
  let hours: number;
  let minutes: number;
  let meridiem: string | undefined;
  let match: RegExpExecArray;
  if (clock) {
    match = clock;
    hours = Number(clock[1]);
    minutes = Number(clock[2]);
    meridiem = clock[3];
  } else if (hour12) {
    match = hour12;
    hours = Number(hour12[1]);
    minutes = 0;
    meridiem = hour12[2];
  } else if (french) {
    match = french;
    hours = Number(french[1]);
    minutes = french[2] ? Number(french[2]) : 0;
  } else {
    return { rest: text, time: null };
  }
  if (meridiem) {
    const pm = meridiem.startsWith("p");
    if (hours < 1 || hours > 12) return { rest: text, time: null };
    hours = (hours % 12) + (pm ? 12 : 0);
  }
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
  if (hours > 23 || minutes > 59) return { rest: text, time: null };
  return { rest, time: `${pad(hours)}:${pad(minutes)}` };
}

function monthDay(day: number, month: number, year: number | undefined, today: Date): string | null {
  if (year !== undefined) return isoDate(twoDigitYear(year), month, day);
  const thisYear = isoDate(today.getFullYear(), month, day);
  if (!thisYear) return null;
  // Without a year the upcoming occurrence is meant.
  return thisYear < dateToIso(today) ? isoDate(today.getFullYear() + 1, month, day) : thisYear;
}

function parseSingle(raw: string, order: DayOrder, today: Date): LooseDate | null {
  const text = stripAccents(raw).toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const { rest, time } = extractTime(text);
  const done = (date: string | null): LooseDate | null => (date ? { date, time: /[z]$|[+-]\d{2}:?\d{2}$/.test(text) ? null : time } : null);

  let match = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(rest);
  if (match) return done(isoDate(Number(match[1]), Number(match[2]), Number(match[3])));

  match = new RegExp(`(\\d{1,2})(?:st|nd|rd|th|er|o)?\\.?\\s+(?:de\\s+|of\\s+)?(${MONTH_PATTERN})\\b\\.?(?:,?\\s+(?:de\\s+)?(\\d{4}))?`).exec(rest);
  if (match) return done(monthDay(Number(match[1]), MONTHS[match[2]], match[3] ? Number(match[3]) : undefined, today));

  match = new RegExp(`\\b(${MONTH_PATTERN})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?`).exec(rest);
  if (match) return done(monthDay(Number(match[2]), MONTHS[match[1]], match[3] ? Number(match[3]) : undefined, today));

  match = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(rest);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = twoDigitYear(Number(match[3]));
    let day = order === "dmy" ? first : second;
    let month = order === "dmy" ? second : first;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return done(isoDate(year, month, day));
  }

  const word = rest
    .replace(/^(?:on|le|el|am|em|next|prochain|proximo|nachsten)\s+/, "")
    .replace(/\s+(?:at|a|a las|as|um|vers)$/, "")
    .replace(/[.,]/g, "");
  if (Object.prototype.hasOwnProperty.call(RELATIVE_DAYS, word)) return done(dateToIso(addDays(today, RELATIVE_DAYS[word])));
  const weekday = word.split(" ")[0];
  if (Object.prototype.hasOwnProperty.call(WEEKDAYS, weekday) && word.split(" ").length <= 2) {
    const ahead = ((WEEKDAYS[weekday] - today.getDay() + 6) % 7) + 1;
    return done(dateToIso(addDays(today, ahead)));
  }
  return null;
}

/**
 * Reads one date (and optional time) out of text. A range ("A → B") yields
 * its end. Returns null when nothing date-like is found.
 */
export function parseLooseDate(input: string, options: Options = {}): LooseDate | null {
  const order = options.order ?? "dmy";
  const today = options.today ?? new Date();
  const text = input.trim();
  if (!text) return null;
  const parts = text.split(/\s*(?:→|->|=>)\s*|\s+to\s+/i).filter((part) => part.trim() !== "");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const parsed = parseSingle(parts[index], order, today);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Day-first or month-first for the numeric dates of one file: decided by the
 * first date that can only be read one way (31/10/2026, 10/31/2026), else the
 * fallback (the reader's language).
 */
export function inferDayOrder(texts: readonly string[], fallback: DayOrder = "dmy"): DayOrder {
  for (const text of texts) {
    const match = /(?:^|\D)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D|$)/.exec(text);
    if (!match) continue;
    if (Number(match[1]) > 12) return "dmy";
    if (Number(match[2]) > 12) return "mdy";
  }
  return fallback;
}

/** Whether a date field describes a repeating schedule ("every monday", "tous les jours"). */
export function looksRecurring(text: string): boolean {
  return /\bevery\b|\bchaque\b|\btous les\b|\btoutes les\b|\bjede[nrs]?\b|\btodos (?:los|os)\b|\btodas (?:las|as)\b|\bcada\b|\btodo dia\b|\btoda semana\b/i.test(stripAccents(text));
}
