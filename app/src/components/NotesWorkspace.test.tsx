import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesWorkspace, renderMarkdown } from "./NotesWorkspace";
import { notesStore } from "../lib/notes";

describe("Notes markdown and math rendering", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        clear: () => data.clear(),
      } as unknown as Storage,
    });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders inline and display math with data-tex attributes", () => {
    const html = renderMarkdown("Try $E = mc^2$ and $$\\sum_{i=1}^n i$$ in note", {}, {});
    expect(html).toContain('<span class="note-math" data-tex="E = mc^2">E = mc^2</span>');
    expect(html).toContain('<span class="note-math note-math-display" data-tex="\\sum_{i=1}^n i">\\sum_{i=1}^n i</span>');
  });

  it("does not duplicate math when switching between notes with the same formula in Read mode", async () => {
    // Create two notes with the exact same math body
    const note1 = notesStore.create("Note 1");
    notesStore.update({ ...note1, body: "Try $E = mc^2$ for inline math." });
    const note2 = notesStore.create("Note 2");
    notesStore.update({ ...note2, body: "Try $E = mc^2$ for inline math." });

    render(<NotesWorkspace />);

    // Switch to Read mode
    const readButton = screen.getByRole("button", { name: "Read" });
    fireEvent.click(readButton);

    // Wait for Note 2 (latest updated) to display and hydrate KaTeX
    await waitFor(() => {
      const mathElements = document.querySelectorAll(".note-math");
      expect(mathElements.length).toBe(1);
      expect(mathElements[0]?.getAttribute("data-rendered")).toBe("true");
    }, { timeout: 5000 });

    // Count formula occurrences in the reading container
    const readingPane = document.querySelector(".notes-reading");
    expect(readingPane).not.toBeNull();
    const mathTextBefore = document.querySelector(".note-math")?.textContent ?? "";

    // Switch to Note 1
    const note1Tab = screen.getByRole("button", { name: /Note 1/ });
    fireEvent.click(note1Tab);

    // Wait and verify math did not duplicate
    await waitFor(() => {
      const mathElements = document.querySelectorAll(".note-math");
      expect(mathElements.length).toBe(1);
    });

    const mathTextAfterNote1 = document.querySelector(".note-math")?.textContent ?? "";
    expect(mathTextAfterNote1).toBe(mathTextBefore);

    // Switch back to Note 2
    const note2Tab = screen.getByRole("button", { name: /Note 2/ });
    fireEvent.click(note2Tab);

    await waitFor(() => {
      const mathElements = document.querySelectorAll(".note-math");
      expect(mathElements.length).toBe(1);
    });

    const mathTextAfterNote2 = document.querySelector(".note-math")?.textContent ?? "";
    expect(mathTextAfterNote2).toBe(mathTextBefore);
  });
});
