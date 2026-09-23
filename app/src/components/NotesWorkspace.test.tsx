import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    }, { timeout: 10000 }); // cold dynamic import of mermaid + KaTeX is slow under a parallel full-suite run

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
  }, 15000);

  it("groups quote lines and renders typed callouts and labelled code blocks", () => {
    const html = renderMarkdown("> first\n> second\n\n> [!tip] Astuce\n> Ask the agent\n\n```ts\nconst a = 1;\n```", {}, {});
    expect(html).toContain("<blockquote><p>first</p><p>second</p></blockquote>");
    expect(html).toContain('<div class="note-callout" data-callout="tip"><p class="note-callout-title">Astuce</p><p>Ask the agent</p></div>');
    expect(html).toContain('<pre class="note-code" data-lang="ts"><code>const a = 1;</code></pre>');
  });
});

describe("Notes workspace layout", () => {
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
  });

  it("switches between Write and Read and shows real tags, word count and note count", () => {
    const linked = notesStore.create("Reading list");
    notesStore.update({ ...linked, body: "See [[Welcome]] for the basics." });
    const welcome = notesStore.create("Welcome");
    notesStore.update({ ...welcome, body: "# Intro\nStart with #ideas and #guide.\n## Links" });

    render(<NotesWorkspace />);
    fireEvent.click(within(screen.getByRole("tree")).getByRole("button", { name: "Welcome" }));

    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ideas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "guide" })).toBeInTheDocument();
    expect(screen.getByText("9 words")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Intro\nStart with #ideas and #guide.\n## Links");
    expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome");

    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("keeps the inspector closed by default and shows outline and backlinks when opened", () => {
    const linked = notesStore.create("Reading list");
    notesStore.update({ ...linked, body: "See [[Welcome]] for the basics." });
    const welcome = notesStore.create("Welcome");
    notesStore.update({ ...welcome, body: "# Overview\n## Links\ntext" });

    render(<NotesWorkspace />);
    fireEvent.click(within(screen.getByRole("tree")).getByRole("button", { name: "Welcome" }));

    expect(screen.queryByRole("complementary", { name: "Note details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));
    const inspector = screen.getByRole("complementary", { name: "Note details" });
    expect(inspector).toHaveTextContent("Backlinks · 1");
    expect(inspector).toHaveTextContent("Links");
    expect(screen.getByRole("button", { name: "Overview", current: "location" })).toBeInTheDocument();
  });

  it("opens a note as its own screen on mobile and returns to the explorer", () => {
    const welcome = notesStore.create("Welcome");
    notesStore.update({ ...welcome, body: "Hello" });

    const { container } = render(<NotesWorkspace />);
    const workspace = container.querySelector(".notes-workspace");
    expect(workspace).toHaveAttribute("data-mobile-view", "list");

    fireEvent.click(screen.getByRole("button", { name: /Welcome/ }));
    expect(workspace).toHaveAttribute("data-mobile-view", "note");

    fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
    expect(workspace).toHaveAttribute("data-mobile-view", "list");
  });
});
