import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal, SimpleFormModal } from "./Modal";

afterEach(() => cleanup());

describe("Modal component", () => {
  it("renders centered modal with title, handles Escape key and backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Test Modal" onClose={onClose}>
        <div>Modal Content</div>
      </Modal>
    );

    expect(screen.getByRole("dialog", { name: "Test Modal" })).toBeInTheDocument();
    expect(screen.getByText("Modal Content")).toBeInTheDocument();

    // Escape closes
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clicking outside (on backdrop) closes
    const backdrop = container.querySelector(".prior-modal-backdrop");
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
      expect(onClose).toHaveBeenCalledTimes(2);
    }
  });

  it("restores focus to previous active element on unmount", () => {
    const button = document.createElement("button");
    button.textContent = "Open modal";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const { unmount } = render(
      <Modal title="Focus Test" onClose={vi.fn()}>
        <input placeholder="Inner input" autoFocus />
      </Modal>
    );

    unmount();
    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });

  it("submits on Enter in SimpleFormModal when input is valid, rejects empty input", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    function TestHarness() {
      const [name, setName] = useState("");
      return (
        <SimpleFormModal
          title="New Area"
          submitLabel="Create area"
          name={name}
          onNameChange={setName}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      );
    }

    render(<TestHarness />);

    const input = screen.getByRole("textbox");
    const submitBtn = screen.getByRole("button", { name: "Create area" });

    expect(submitBtn).toBeDisabled();

    // Trying to submit with empty name
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();

    // Type valid name
    fireEvent.change(input, { target: { value: "Engineering" } });
    expect(submitBtn).not.toBeDisabled();

    // Submit via Enter
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
