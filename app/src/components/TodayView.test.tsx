import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Habit, Project, Task, TaskDraft } from "../types";
import { TodayView, quickAddDraft } from "./TodayView";
import { WaitingView } from "./WaitingView";
import { parseTaskTitle } from "../lib/taskTitleParser";
import { localDateKey } from "../lib/todayPlan";

afterEach(cleanup);

const today = localDateKey(new Date());
const projects: Project[] = [{ id: "p1", name: "Launch website", areaId: "a1", description: "", status: "active", createdAt: "", updatedAt: "", deletedAt: null }];

function task(overrides: Partial<Task>): Task {
  const now = new Date().toISOString();
  return { id: overrides.title ?? "t", title: "Task", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, status: "next", createdAt: now, updatedAt: now, deletedAt: null, ...overrides };
}

function props(overrides: Partial<Parameters<typeof TodayView>[0]> = {}): Parameters<typeof TodayView>[0] {
  return {
    tasks: [], waitingTasks: [], projects, areas: [], habits: [],
    onNewTask: vi.fn(), onOpenWaiting: vi.fn(), onTaskChange: vi.fn(async () => undefined), onTaskDelete: vi.fn(async () => undefined), onTaskEdit: vi.fn(),
    ...overrides,
  };
}

describe("TodayView", () => {
  it("summarizes the focus count and splits priorities from what comes next", () => {
    const tasks = [
      task({ title: "Build pricing section", priority: 1, important: true, urgent: true, projectId: "p1" }),
      task({ title: "Book dentist", dueDate: today }),
      task({ title: "Fix navigation", status: "in_progress", important: true }),
      task({ title: "Write announcement" }),
    ];
    render(<TodayView {...props({ tasks })} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Three things matter today.");
    const priorities = screen.getByRole("region", { name: "Current priorities" });
    expect(within(priorities).getByText("Build pricing section")).toBeInTheDocument();
    expect(within(priorities).queryByText("Write announcement")).not.toBeInTheDocument();
    const upNext = screen.getByRole("region", { name: "Up next" });
    expect(within(upNext).getByText("Write announcement")).toBeInTheDocument();
  });

  it("opens the agent from the plan button and hides it without a hook", () => {
    const onOpenAgent = vi.fn();
    const { rerender } = render(<TodayView {...props({ onOpenAgent })} />);
    fireEvent.click(screen.getByRole("button", { name: "Plan my day" }));
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
    rerender(<TodayView {...props()} />);
    expect(screen.queryByRole("button", { name: "Plan my day" })).not.toBeInTheDocument();
  });

  it("quick-adds a task in one step through the title parser", async () => {
    const onQuickAddTask = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TodayView {...props({ onQuickAddTask })} />);
    fireEvent.change(screen.getByLabelText("Quick add a task"), { target: { value: "Call Lea tomorrow at 3pm p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await waitFor(() => expect(onQuickAddTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Call Lea", priority: 1, dueTime: "15:00", status: "next" })));
    await waitFor(() => expect(screen.getByLabelText("Quick add a task")).toHaveValue(""));
  });

  it("toggles today's habits through the completion handler", () => {
    const habit: Habit = { id: "h1", title: "Walk 30 minutes", important: false, urgent: false, interval: 1, unit: "day", startDate: "2020-01-01", completedDates: [], createdAt: "", updatedAt: "", deletedAt: null };
    const onHabitComplete = vi.fn(async () => undefined);
    render(<TodayView {...props({ habits: [habit], onHabitComplete })} />);
    const habits = screen.getByRole("region", { name: "Habits" });
    fireEvent.click(within(habits).getByRole("checkbox", { name: "Mark Walk 30 minutes done" }));
    expect(onHabitComplete).toHaveBeenCalledWith(habit, today);
  });

  it("lists waiting work with who it depends on", () => {
    const waiting = task({ title: "Send brief", status: "waiting", assigneeName: "Alex Rivera" });
    const onTaskEdit = vi.fn();
    render(<TodayView {...props({ waitingTasks: [waiting], onTaskEdit })} />);
    const card = screen.getByRole("region", { name: "Waiting" });
    expect(within(card).getByText(/Alex Rivera/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Plan a follow-up for Send brief" }));
    expect(onTaskEdit).toHaveBeenCalledWith(waiting);
  });
});

describe("quickAddDraft", () => {
  it("maps parsed tokens onto a task draft and inherits the project's area", () => {
    const parsed = parseTaskTitle("Ship it #Launch website p1", { projects, lang: "en-US" });
    expect(quickAddDraft(parsed, projects)).toMatchObject({ title: "Ship it", projectId: "p1", areaId: "a1", priority: 1, status: "next" });
    expect(quickAddDraft(parseTaskTitle("   ", {}), projects)).toBeNull();
  });
});

describe("WaitingView", () => {
  it("groups by person, shows real stats and marks items received", () => {
    const onTaskChange = vi.fn(async () => undefined);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const brief = task({ title: "Send brief", status: "waiting", assigneeName: "Alex Rivera", updatedAt: threeDaysAgo, followUpDate: today, projectId: "p1" });
    const other = task({ title: "Review contract", status: "waiting", assigneeName: "Sam" });
    render(<WaitingView tasks={[brief, other]} projects={projects} onAdd={vi.fn()} onTaskChange={onTaskChange} onTaskEdit={vi.fn()} />);
    expect(screen.getByText("items waiting").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("follow-up due today").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("average wait").previousSibling).toHaveTextContent("1.5 d");
    const alex = screen.getByRole("region", { name: "Alex Rivera" });
    expect(within(alex).getByText("for 3 days")).toBeInTheDocument();
    expect(within(alex).getByText("Follow up today")).toBeInTheDocument();
    fireEvent.click(within(alex).getByRole("button", { name: "Mark Send brief received" }));
    expect(onTaskChange).toHaveBeenCalledWith(expect.objectContaining({ id: brief.id, completed: true }));
    expect(screen.getByRole("region", { name: "Upcoming follow-ups" })).toHaveTextContent("Send brief");
  });

  it("hides the follow-up rail when no follow-up date exists", () => {
    render(<WaitingView tasks={[task({ title: "Solo", status: "waiting" })]} projects={projects} onAdd={vi.fn()} onTaskChange={vi.fn()} onTaskEdit={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Upcoming follow-ups" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "No one assigned" })).toBeInTheDocument();
  });
});
