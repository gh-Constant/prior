import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "./useDictation";

class HookRecognition {
  static instances: HookRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: { length: number; [index: number]: { isFinal: boolean; length: number; [index: number]: { transcript: string } } } }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() { HookRecognition.instances.push(this); }
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}

function Harness({ onCommit }: { onCommit: (result: { value: string; selectionStart: number; selectionEnd: number }) => void }) {
  const dictation = useDictation({ language: "en-US", onCommit });
  return (
    <>
      <button data-start onClick={() => void dictation.start("hello world", { start: 6, end: 6 })} />
      <button data-stop onClick={dictation.stop} />
      <button data-cancel onClick={dictation.cancel} />
      <output data-status>{dictation.status}</output>
      <output data-preview>{dictation.previewText}</output>
    </>
  );
}

describe("useDictation", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    HookRecognition.instances = [];
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("inserts a stopped session at the captured selection and never sends it", async () => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: HookRecognition });
    const onCommit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness onCommit={onCommit} />);
      await Promise.resolve();
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const recognition = HookRecognition.instances.at(-1);
    expect(recognition).toBeDefined();
    expect(recognition?.start).toHaveBeenCalledTimes(1);
    recognition?.onresult?.({ results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: "there" } } } });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-stop]")?.click();
      await Promise.resolve();
    });

    expect(recognition?.stop).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ value: "hello thereworld", selectionStart: 11, selectionEnd: 11 });
    expect(container?.querySelector("[data-status]")?.textContent).toBe("review");
  });

  it("cancels without changing the captured draft", async () => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: HookRecognition });
    const onCommit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness onCommit={onCommit} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      container?.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("[data-cancel]")?.click();
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-status]")?.textContent).toBe("idle");
  });
});
