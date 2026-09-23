import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileMoreScreen } from "./MobileMoreScreen";
import { MobileTabBar, mobileTabFor } from "./MobileTabBar";
import { MobileTopBar } from "./MobileTopBar";
import { markSynced, resetLastSyncedAt } from "../lib/syncStatus";

afterEach(() => {
  cleanup();
  resetLastSyncedAt();
});

function renderTabBar(overrides: Partial<Parameters<typeof MobileTabBar>[0]> = {}) {
  const props = {
    activeView: "today" as const,
    moreOpen: false,
    createLabel: "New task",
    onNavigate: vi.fn(),
    onCreate: vi.fn(),
    onToggleMore: vi.fn(),
    ...overrides,
  };
  render(<MobileTabBar {...props} />);
  return props;
}

describe("mobileTabFor", () => {
  it("maps views to their tab and files everything else under More", () => {
    expect(mobileTabFor("today", false)).toBe("today");
    expect(mobileTabFor("all", false)).toBe("tasks");
    expect(mobileTabFor("calendar", false)).toBe("calendar");
    expect(mobileTabFor("habits", false)).toBe("more");
    expect(mobileTabFor("settings", false)).toBe("more");
    expect(mobileTabFor("today", true)).toBe("more");
  });
});

describe("MobileTabBar", () => {
  it("is a labelled navigation landmark with the current tab marked", () => {
    renderTabBar({ activeView: "all" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("navigates to Today, all tasks and the calendar", () => {
    const props = renderTabBar();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(props.onNavigate.mock.calls.map(([view]) => view)).toEqual(["all", "calendar", "today"]);
  });

  it("creates in context from the central button", () => {
    const props = renderTabBar({ activeView: "habits", createLabel: "New habit" });
    fireEvent.click(screen.getByRole("button", { name: "New habit" }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it("toggles the More screen and highlights it for views that live there", () => {
    const props = renderTabBar({ activeView: "habits" });
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveClass("active");
    fireEvent.click(more);
    expect(props.onToggleMore).toHaveBeenCalledTimes(1);
  });
});

describe("MobileMoreScreen", () => {
  function renderMore(overrides: Partial<Parameters<typeof MobileMoreScreen>[0]> = {}) {
    const props = {
      activeView: "today" as const,
      user: { id: "u1", email: "ada@example.com", displayName: "Ada" },
      agentOpen: false,
      onNavigate: vi.fn(),
      onAgent: vi.fn(),
      onAccount: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    render(<MobileMoreScreen {...props} />);
    return props;
  }

  it("lists the remaining destinations with their live counts", () => {
    const props = renderMore({ badges: { waiting: "2", habits: "1/3" } });
    const list = screen.getByRole("navigation", { name: "Other views" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.dataset.view)).toEqual(["inbox", "projects", "waiting", "eisenhower", "habits", "notes"]);
    expect(within(list).getByRole("button", { name: /Waiting/ })).toHaveTextContent("2");
    expect(within(list).getByRole("button", { name: /Habits/ })).toHaveTextContent("1/3");
    fireEvent.click(within(list).getByRole("button", { name: /Notes/ }));
    expect(props.onNavigate).toHaveBeenCalledWith("notes");
  });

  it("opens the agent, the account and settings", () => {
    const props = renderMore();
    fireEvent.click(screen.getByRole("button", { name: "Open Prior Agent" }));
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(props.onAgent).toHaveBeenCalledTimes(1);
    expect(props.onAccount).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith("settings");
  });

  it("shows the sync status on the account card once a sync has completed", () => {
    markSynced(Date.now());
    renderMore();
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveTextContent("Synced just now");
  });

  it("marks the current destination", () => {
    renderMore({ activeView: "project" });
    expect(screen.getByRole("button", { name: /Projects/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("MobileTopBar", () => {
  it("titles shell-headed views and opens the agent", () => {
    const onAgent = vi.fn();
    render(<MobileTopBar view="all" title="All tasks" agentOpen={false} onAgent={onAgent} />);
    expect(screen.getByRole("heading", { level: 1, name: "All tasks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prior Agent" }));
    expect(onAgent).toHaveBeenCalledTimes(1);
  });

  it("stays out of views that render their own phone heading", () => {
    const { container } = render(<MobileTopBar view="today" title="Today" agentOpen={false} onAgent={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
