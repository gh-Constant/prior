import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AgentThinking } from "./AgentThinking";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentThinking", () => {
  it("shows the mascot thinking next to a status line that moves through phases and holds on the last", () => {
    vi.useFakeTimers();
    const { container } = render(<AgentThinking />);
    expect(container.querySelector("[data-mood='thinking']")).not.toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.getByText("Looking through your tasks…")).toBeDefined();
    act(() => { vi.advanceTimersByTime(2800); });
    expect(screen.getByText("Weighing your priorities…")).toBeDefined();
    act(() => { vi.advanceTimersByTime(2800 * 5); });
    expect(screen.getByText("Preparing proposals…")).toBeDefined();
  });

  it("uses the working mood while a stream runs", () => {
    const { container } = render(<AgentThinking mode="working" />);
    expect(container.querySelector("[data-mood='working']")).not.toBeNull();
    expect(screen.getByText("Working on it…")).toBeDefined();
  });
});
