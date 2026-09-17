import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DictationControls, DictationStatusBar } from "./DictationControls";

afterEach(() => cleanup());

describe("DictationControls", () => {
  it("starts dictation when idle", () => {
    const onStart = vi.fn();
    render(<DictationControls status="idle" onStart={onStart} onStop={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Start voice input"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("stops dictation when listening", () => {
    const onStop = vi.fn();
    render(<DictationControls status="listening" onStart={() => undefined} onStop={onStop} />);
    fireEvent.click(screen.getByLabelText("Stop recording"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables the button when unavailable", () => {
    render(<DictationControls status="unavailable" onStart={() => undefined} onStop={() => undefined} />);
    expect(screen.getByLabelText("Start voice input")).toBeDisabled();
  });
});

describe("DictationStatusBar", () => {
  it("shows listening state with cancel", () => {
    const onCancel = vi.fn();
    render(<DictationStatusBar status="listening" error={null} onCancel={onCancel} onDismissError={() => undefined} />);
    expect(screen.getByText("Recording… tap stop to transcribe")).toBeDefined();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows errors with dismiss", () => {
    const onDismissError = vi.fn();
    render(<DictationStatusBar status="error" error="Microphone blocked" onCancel={() => undefined} onDismissError={onDismissError} />);
    expect(screen.getByText("Microphone blocked")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Dismiss dictation error"));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when idle without errors", () => {
    const { container } = render(<DictationStatusBar status="idle" error={null} onCancel={() => undefined} onDismissError={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
