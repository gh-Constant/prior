import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskTitleInput } from "./TaskTitleInput";

afterEach(cleanup);

describe("TaskTitleInput", () => {
  it("renders recognized fields as colored tokens and reports token clicks", () => {
    const onTokenClick = vi.fn();
    const { container } = render(
      <TaskTitleInput
        value="Do homework tomorrow at 3pm"
        onChange={vi.fn()}
        onTokenClick={onTokenClick}
        placeholder="What needs to be done?"
        ariaLabel="Task title"
      />,
    );

    expect(screen.getByLabelText("Task title")).toHaveValue("Do homework tomorrow at 3pm");
    expect(container.querySelectorAll(".task-title-token")).toHaveLength(2);
    expect(container.querySelector(".task-title-token-dueDate")).toHaveTextContent("tomorrow");
    expect(container.querySelector(".task-title-token-dueTime")).toHaveTextContent("at 3pm");

    fireEvent.mouseDown(container.querySelector(".task-title-token-dueDate")!);
    expect(onTokenClick).toHaveBeenCalledWith(expect.objectContaining({ field: "dueDate", raw: "tomorrow" }));
  });
});
