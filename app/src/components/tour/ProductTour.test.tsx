import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENABLED_VIEWS } from "../../lib/navigation";
import { ProductTour } from "./ProductTour";

afterEach(cleanup);

const shortcut = { newTask: "⌘ N", assistant: "⌘ J", palette: "⌘ K" };
const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };

describe("ProductTour", () => {
  it("pre-selects the popular spaces and only explains the chosen ones", () => {
    const onFinish = vi.fn();
    render(<ProductTour user={user} initialEnabled={DEFAULT_ENABLED_VIEWS} shortcut={shortcut} onFinish={onFinish} onSkip={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /Calendar/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Mail inbox/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("checkbox", { name: /Habits/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Mail inbox/ }));

    const titles: string[] = [];
    for (let guard = 0; guard < 20 && !screen.queryByRole("button", { name: /Go to Today/ }); guard += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
      titles.push(screen.getByRole("heading", { level: 1 }).textContent ?? "");
    }
    expect(titles).toContain("From email to task");
    expect(titles).not.toContain("Build routines that stick");

    fireEvent.click(screen.getByRole("button", { name: /Start a focus session/ }));
    expect(onFinish).toHaveBeenCalledWith(["calendar", "focus", "eisenhower", "notes", "inbox"], "focus");
  });

  it("does not change the navigation when skipped before choosing", () => {
    const onSkip = vi.fn();
    render(<ProductTour user={user} initialEnabled={DEFAULT_ENABLED_VIEWS} shortcut={shortcut} onFinish={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledWith(null);
  });

  it("moves with the arrow keys", () => {
    render(<ProductTour user={user} initialEnabled={[]} shortcut={shortcut} onFinish={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Today is your starting point");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Which spaces do you want?");
  });
});
