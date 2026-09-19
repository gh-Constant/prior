import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Area, Project } from "../types";
import { ProjectsOverview } from "./ProjectsOverview";

const timestamps = { createdAt: "2026-09-01", updatedAt: "2026-09-01", deletedAt: null };
const areas: Area[] = [
  { ...timestamps, id: "work", name: "Studio", color: "#c96551" },
  { ...timestamps, id: "personal", name: "Personal", color: "#7c9b70" },
];
const projects: Project[] = [
  { ...timestamps, id: "launch", areaId: "work", name: "A complete website launch with a deliberately long project name", description: "Brand and editorial direction", status: "active", projectType: "standard" },
  { ...timestamps, id: "app", areaId: "work", name: "App", description: "", status: "planned", projectType: "software" },
  { ...timestamps, id: "shared", areaId: "unavailable-area", name: "Shared project", description: "", status: "paused" },
];
const callbacks = () => ({
  onOpenProject: vi.fn(), onNewProject: vi.fn(), onNewArea: vi.fn(),
  onEditArea: vi.fn(), onDeleteArea: vi.fn(), onEditProject: vi.fn(), onDeleteProject: vi.fn(),
});
function setup(input: Partial<{ areas: Area[]; projects: Project[] }> = {}) {
  const actions = callbacks();
  function Harness() {
    const [query, setQuery] = useState("");
    return <ProjectsOverview areas={input.areas ?? areas} projects={input.projects ?? projects} query={query} onQueryChange={setQuery} {...actions} />;
  }
  render(<Harness />);
  return actions;
}
beforeEach(() => {
  if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
    localStorage.setItem("prior.language", "en");
  }
});
afterEach(() => {
  cleanup();
  if (typeof localStorage !== "undefined" && typeof localStorage.clear === "function") {
    localStorage.clear();
  }
});

describe("ProjectsOverview", () => {
  it("keeps complete names and both kinds of metadata, with separate open and edit actions", () => {
    const actions = setup();
    const name = projects[0].name;
    expect(screen.getByText(name)).toBeVisible();
    const card = screen.getByRole("button", { name: `Open ${name}` });
    expect(within(card).getByText("Standard")).toBeVisible();
    expect(within(card).getByText("Active")).toBeVisible();
    fireEvent.click(card);
    expect(actions.onOpenProject).toHaveBeenCalledWith("launch");
    fireEvent.click(screen.getByRole("button", { name: `Edit ${name} project` }));
    expect(actions.onEditProject).toHaveBeenCalledWith(projects[0]);
    expect(actions.onOpenProject).toHaveBeenCalledTimes(1);
  });

  it("combines trimmed area and description search with status filters and resets both", () => {
    setup();
    const search = screen.getByRole("searchbox", { name: "Search projects or areas" });
    fireEvent.change(search, { target: { value: "  STUDIO  " } });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Planned 1" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open App" })).toBeVisible();
    fireEvent.change(search, { target: { value: "editorial" } });
    expect(screen.getByText("No matching projects")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("keeps projects whose area is unavailable visible under No area", () => {
    setup();
    expect(within(screen.getByRole("region", { name: "No area" })).getByRole("button", { name: "Open Shared project" })).toBeVisible();
  });

  it("offers creation in empty areas and accessible area management", () => {
    const actions = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create your first project in Personal" }));
    expect(actions.onNewProject).toHaveBeenCalledWith("personal");
    fireEvent.click(screen.getByRole("button", { name: "New project in Studio" }));
    expect(actions.onNewProject).toHaveBeenCalledWith("work");
    fireEvent.click(screen.getByRole("button", { name: "Options for Studio area" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Studio area" }));
    expect(actions.onEditArea).toHaveBeenCalledWith(areas[0]);
    fireEvent.click(screen.getByRole("button", { name: "Options for Studio area" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Studio area" }));
    expect(actions.onDeleteArea).toHaveBeenCalledWith(areas[0]);
  });

  it("preserves project context menu actions", () => {
    const actions = setup();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Open App" }), { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete App" }));
    expect(actions.onDeleteProject).toHaveBeenCalledWith(projects[1]);
  });

  it("shows one useful empty state and keeps both creation actions available", () => {
    const actions = setup({ areas: [], projects: [] });
    expect(screen.getByText("Your projects will live here")).toBeVisible();
    expect(screen.queryByRole("region", { name: "No area" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[1]);
    expect(actions.onNewProject).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "New area" }));
    expect(actions.onNewArea).toHaveBeenCalledTimes(1);
  });
});

