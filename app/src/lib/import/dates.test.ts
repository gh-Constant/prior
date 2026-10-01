import { describe, expect, it } from "vitest";
import { inferDayOrder, looksRecurring, parseLooseDate } from "./dates";
import { TODAY } from "./__fixtures__";

const read = (text: string, order?: "dmy" | "mdy") => parseLooseDate(text, { today: TODAY, order });

describe("parseLooseDate", () => {
  it("reads ISO dates and timestamps", () => {
    expect(read("2026-10-03")).toEqual({ date: "2026-10-03", time: null });
    expect(read("2026-10-03T14:30:00")).toEqual({ date: "2026-10-03", time: "14:30" });
    expect(read("2026-10-03T14:30:00.000Z")).toEqual({ date: "2026-10-03", time: null });
    expect(read("2026/10/03")).toEqual({ date: "2026-10-03", time: null });
  });

  it("reads month names in five languages", () => {
    for (const text of ["October 3, 2026", "Oct 3 2026", "3 October 2026", "3 octobre 2026", "3. Oktober 2026", "3 de octubre de 2026", "3 de outubro de 2026", "3rd Oct 2026"]) {
      expect(read(text)?.date, text).toBe("2026-10-03");
    }
    expect(read("1 février 2027")?.date).toBe("2027-02-01");
    expect(read("12 déc. 2026")?.date).toBe("2026-12-12");
  });

  it("uses the upcoming occurrence when the year is left out", () => {
    expect(read("Oct 15")?.date).toBe("2026-10-15");
    expect(read("15 oct")?.date).toBe("2026-10-15");
    expect(read("Sep 5")?.date).toBe("2027-09-05");
  });

  it("reads numeric dates in the order asked and fixes impossible ones", () => {
    expect(read("03/10/2026", "dmy")?.date).toBe("2026-10-03");
    expect(read("03/10/2026", "mdy")?.date).toBe("2026-03-10");
    expect(read("31.10.2026")?.date).toBe("2026-10-31");
    expect(read("10/31/2026", "dmy")?.date).toBe("2026-10-31");
    expect(read("3-10-26")?.date).toBe("2026-10-03");
    expect(read("31/02/2026")).toBeNull();
  });

  it("takes the end of a range", () => {
    expect(read("October 3, 2026 → October 10, 2026")?.date).toBe("2026-10-10");
    expect(read("2026-10-03 → 2026-10-05")?.date).toBe("2026-10-05");
  });

  it("reads times", () => {
    expect(read("October 3, 2026 2:30 PM")).toEqual({ date: "2026-10-03", time: "14:30" });
    expect(read("3 octobre 2026 14h30")).toEqual({ date: "2026-10-03", time: "14:30" });
    expect(read("tomorrow at 14:30")).toEqual({ date: "2026-10-02", time: "14:30" });
    expect(read("Oct 3 2026 12am")).toEqual({ date: "2026-10-03", time: "00:00" });
  });

  it("reads relative words and weekdays", () => {
    expect(read("today")?.date).toBe("2026-10-01");
    expect(read("tomorrow")?.date).toBe("2026-10-02");
    expect(read("demain")?.date).toBe("2026-10-02");
    expect(read("monday")?.date).toBe("2026-10-05");
    expect(read("next friday")?.date).toBe("2026-10-02");
    expect(read("jeudi")?.date).toBe("2026-10-08");
  });

  it("returns null for anything else", () => {
    expect(read("")).toBeNull();
    expect(read("someday maybe")).toBeNull();
    expect(read("constructor")).toBeNull();
  });
});

describe("inferDayOrder", () => {
  it("lets one unambiguous date decide for the whole file", () => {
    expect(inferDayOrder(["03/10/2026", "31/10/2026"], "mdy")).toBe("dmy");
    expect(inferDayOrder(["03/10/2026", "10/31/2026"], "dmy")).toBe("mdy");
    expect(inferDayOrder(["03/10/2026", "", "October 3, 2026"], "mdy")).toBe("mdy");
    expect(inferDayOrder([], "dmy")).toBe("dmy");
  });
});

describe("looksRecurring", () => {
  it("spots repeat phrases", () => {
    for (const text of ["every monday", "every! 2 weeks", "tous les jours", "toutes les semaines", "chaque lundi", "jeden Montag", "todos los días", "cada semana"]) {
      expect(looksRecurring(text), text).toBe(true);
    }
    for (const text of ["tomorrow", "Oct 3", "2026-10-03", "next monday"]) expect(looksRecurring(text), text).toBe(false);
  });
});
