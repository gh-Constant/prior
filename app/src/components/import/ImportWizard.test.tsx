import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES } from "../../lib/import/__fixtures__";
import { emptyBatch, makeTask } from "../../lib/import/types";

const loadAiAccess = vi.fn();
const organiseWithAi = vi.fn();

vi.mock("../../lib/import/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/import/ai")>();
  return { ...actual, loadAiAccess: () => loadAiAccess(), organiseWithAi: (...args: unknown[]) => organiseWithAi(...args) };
});

import { ImportWizard } from "./ImportWizard";
import { localStore } from "../../lib/localStore";

function file(name: string, text: string): File {
  const created = new File([text], name, { type: "text/csv" });
  // jsdom's File has no arrayBuffer() in every version.
  Object.defineProperty(created, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return created;
}

async function addFile(name: string, text: string) {
  const input = screen.getByLabelText("Choose files") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file(name, text)] } });
  await screen.findByText(name);
}

describe("ImportWizard", () => {
  const onImport = vi.fn();
  const onNavigate = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    loadAiAccess.mockResolvedValue("signed-out");
    onImport.mockImplementation(async (plan: { tasks: unknown[]; projects: unknown[] }, progress?: (done: number, total: number) => void) => {
      progress?.(plan.tasks.length, plan.tasks.length);
      return { tasks: plan.tasks.length, projects: plan.projects.length };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("imports a pasted list in three steps, without AI", async () => {
    render(<ImportWizard onImport={onImport} onNavigate={onNavigate} />);
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.queryByText("Organise with Prior AI")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value: "# Home\n- Fix the tap tomorrow p1\n- [x] Buy bread\n  - Sourdough" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("3 tasks · 1 project")).toBeInTheDocument();
    expect(screen.getByText("Fix the tap")).toBeInTheDocument();
    // The completed task is left out until asked.
    expect(screen.getByText("Completed")).toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Import 2 tasks" });
    fireEvent.click(importButton);

    await screen.findByText("Import complete");
    expect(onImport).toHaveBeenCalledTimes(1);
    const plan = onImport.mock.calls[0][0];
    expect(plan.tasks.map((task: { title: string }) => task.title)).toEqual(["Fix the tap", "Sourdough"]);
    expect(plan.tasks[1].parentKey).toBeNull();
    expect(plan.projects).toEqual([{ name: "Home", areaName: null, projectType: "standard" }]);
    expect(screen.getByText("2 tasks and 1 project imported.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open tasks" }));
    expect(onNavigate).toHaveBeenCalledWith("all");
  });

  it("previews a Todoist file by project, lets tasks be unticked and keeps sub-tasks", async () => {
    render(<ImportWizard onImport={onImport} onNavigate={onNavigate} />);
    await addFile(FIXTURES.todoist.name, FIXTURES.todoist.text);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("10 tasks · 1 project")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Call the plumber"));
    expect(screen.getByText("9 of 10 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import 9 tasks" }));

    await screen.findByText("Import complete");
    const plan = onImport.mock.calls[0][0];
    expect(plan.tasks).toHaveLength(9);
    const announcement = plan.tasks.find((task: { title: string }) => task.title === "Write the announcement");
    const launch = plan.tasks.find((task: { title: string }) => task.title === "Plan the launch");
    expect(announcement.parentKey).toBe(launch.key);
    expect(plan.tasks.indexOf(launch)).toBeLessThan(plan.tasks.indexOf(announcement));
  });

  it("offers completed Linear issues only when asked, and files areas from the teams", async () => {
    render(<ImportWizard onImport={onImport} />);
    await addFile(FIXTURES.linear.name, FIXTURES.linear.text);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("6 tasks · 3 projects")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getAllByText("Software").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Import 4 tasks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Include completed tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 6 tasks" }));

    await screen.findByText("Import complete");
    const plan = onImport.mock.calls[0][0];
    expect(plan.projects.map((project: { name: string; areaName: string }) => [project.name, project.areaName])).toEqual([["Platform", "Engineering"], ["Engineering", "Engineering"], ["Design", "Design"]]);
    expect(plan.tasks.filter((task: { completed: boolean }) => task.completed)).toHaveLength(2);
  });

  it("skips tasks that already exist in Prior", async () => {
    await localStore.saveTask({ title: "Call the plumber", important: false, urgent: false });
    render(<ImportWizard onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value: "- Call the plumber\n- Water the plants" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    // No project in a pasted list: the existing task has none either, so it is a duplicate.
    expect(await screen.findByText("1 already in Prior")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 task" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Skip tasks that already exist" }));
    expect(screen.getByRole("button", { name: "Import 2 tasks" })).toBeInTheDocument();
  });

  it("shows the column mapping for a generic CSV and applies a change", async () => {
    render(<ImportWizard onImport={onImport} />);
    await addFile("mystery.csv", "Foo,Bar\nCall mum,x\nPay rent,y\n");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("2 tasks · 0 projects");
    const mapping = screen.getByText("Columns").closest("details") as HTMLElement;
    expect(mapping).toHaveAttribute("open");
    expect(within(mapping).getByText("Check which column holds what. The preview updates.")).toBeInTheDocument();
  });

  it("explains an empty result instead of moving on", async () => {
    render(<ImportWizard onImport={onImport} />);
    await addFile("empty.csv", "Name,Due\n");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tasks found");
  });

  describe("AI mode", () => {
    it("is disabled with an upgrade link when the plan does not include it", async () => {
      loadAiAccess.mockResolvedValue("locked");
      render(<ImportWizard onImport={onImport} onNavigate={onNavigate} />);
      expect(await screen.findByText("Available with Pro.")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Organise with Prior AI" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "See plans" }));
      expect(onNavigate).toHaveBeenCalledWith("plans");
    });

    it("sends the files through Prior AI and shows the result in the same preview", async () => {
      loadAiAccess.mockResolvedValue("ready");
      organiseWithAi.mockImplementation(async () => {
        const batch = emptyBatch("text");
        batch.tasks = [makeTask("ai1:1", "Call the bank", { priority: 2, dueDate: "2026-10-02" })];
        return { batch, requests: 1, warnings: [], stopped: null };
      });
      render(<ImportWizard onImport={onImport} />);
      const toggle = await screen.findByRole("switch", { name: "Organise with Prior AI" });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value: "ring the bank tmrw, important" } });
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));

      expect(await screen.findByText("Organised with Prior AI. Check the tasks before importing.")).toBeInTheDocument();
      expect(organiseWithAi).toHaveBeenCalledTimes(1);
      expect(organiseWithAi.mock.calls[0][0].files).toHaveLength(1);
      expect(onImport).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Import 1 task" }));
      await screen.findByText("Import complete");
    });

    it("falls back to the plain reader and says so when the API refuses", async () => {
      loadAiAccess.mockResolvedValue("ready");
      organiseWithAi.mockImplementation(async (input: { files: Array<{ file: { text: string } }> }) => {
        const batch = emptyBatch("text");
        batch.tasks = [makeTask("t:1", input.files[0].file.text.trim())];
        return { batch, requests: 1, warnings: [], stopped: "plan" };
      });
      render(<ImportWizard onImport={onImport} onNavigate={onNavigate} />);
      const toggle = await screen.findByRole("switch", { name: "Organise with Prior AI" });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value: "Water plants" } });
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      expect(await screen.findByText(/AI organising is included in Pro/)).toBeInTheDocument();
      expect(screen.getByText("Water plants")).toBeInTheDocument();
    });
  });
});
