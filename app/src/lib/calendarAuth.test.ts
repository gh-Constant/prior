import { describe, expect, it } from "vitest";
import { parseCalendarConnectedUrl } from "./calendarAuth";

describe("Google Calendar callback", () => {
  it("parses a successful web hash callback", () => {
    expect(parseCalendarConnectedUrl("https://app.prior.constantsuchet.fr/#/calendar-connected?email=me%40example.com")).toEqual({
      email: "me@example.com",
      error: null,
    });
  });

  it("parses native callback errors and ignores other URLs", () => {
    expect(parseCalendarConnectedUrl("prior://auth/callback#/calendar-connected?error=calendar_denied")).toEqual({ email: null, error: "calendar_denied" });
    expect(parseCalendarConnectedUrl("prior://auth/callback?code=sign-in-code")).toBeNull();
  });
});
