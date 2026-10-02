import { describe, expect, it } from "vitest";
import { parseRoute, routeToPath, samePage } from "./router";

const at = (href: string) => {
  const url = new URL(href, "https://app.example");
  return { pathname: url.pathname, search: url.search };
};

describe("app routes", () => {
  it("round-trips every page through the address bar", () => {
    const routes = [
      { view: "today" as const },
      { view: "mine" as const },
      { view: "all" as const },
      { view: "eisenhower" as const },
      { view: "projects" as const },
      { view: "project" as const, projectId: "7f1c2d3e-aaaa-bbbb-cccc-123456789abc", projectTab: "issues" },
      { view: "project" as const, projectId: "7f1c2d3e-aaaa-bbbb-cccc-123456789abc", projectTab: "poker" },
      { view: "notes" as const, notesProjectId: "p1" },
      { view: "settings" as const, settingsTab: "security" as const },
      { view: "settings" as const, settingsTab: "import" as const },
      { view: "project" as const, projectId: "p2", projectTab: null, taskId: "t-9" },
    ];
    for (const route of routes) {
      const parsed = parseRoute(at(routeToPath(route)));
      expect(parsed).toMatchObject(route);
    }
    expect(routeToPath({ view: "mine" })).toBe("/my-tasks");
    expect(routeToPath({ view: "eisenhower" })).toBe("/matrix");
  });

  it("opens a task on top of a page with ?task=", () => {
    expect(parseRoute(at("/tasks?task=abc-123"))).toEqual({ view: "all", taskId: "abc-123" });
    expect(routeToPath({ view: "today", taskId: "abc" })).toBe("/today?task=abc");
    expect(samePage("/today?task=abc", "/today")).toBe(true);
    expect(samePage("/today", "/projects")).toBe(false);
  });

  it("falls back to Today for unknown paths and ignores unsafe ids", () => {
    expect(parseRoute(at("/"))).toEqual({ view: "today" });
    expect(parseRoute(at("/reset-password?token=x"))).toEqual({ view: "today" });
    expect(parseRoute(at("/invite/abc"))).toEqual({ view: "today" });
    expect(parseRoute(at("/projects/%3Cscript%3E"))).toEqual({ view: "projects" });
    expect(parseRoute(at("/projects/p1/unknown-tab"))).toEqual({ view: "project", projectId: "p1", projectTab: null });
    expect(parseRoute(at("/settings/nope"))).toEqual({ view: "settings", settingsTab: null });
  });
});
