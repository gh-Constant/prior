import { describe, expect, it } from "vitest";
import { toRecurrence } from "./recurrence";

describe("toRecurrence", () => {
  it("reads Todoist repeat phrases", () => {
    expect(toRecurrence("every day")).toMatchObject({ interval: 1, unit: "day" });
    expect(toRecurrence("every 2 weeks")).toMatchObject({ interval: 2, unit: "week" });
    expect(toRecurrence("every monday")).toMatchObject({ unit: "week", daysOfWeek: [1] });
    expect(toRecurrence("every! 3 days")).toMatchObject({ interval: 3, unit: "day", basis: "completion" });
  });

  it("reads French phrases", () => {
    expect(toRecurrence("tous les jours")).toMatchObject({ interval: 1, unit: "day" });
    expect(toRecurrence("chaque lundi")).toMatchObject({ unit: "week", daysOfWeek: [1] });
  });

  it("returns null for plain dates and noise", () => {
    expect(toRecurrence("")).toBeNull();
    expect(toRecurrence("2026-10-03")).toBeNull();
    expect(toRecurrence("tomorrow")).toBeNull();
  });
});
