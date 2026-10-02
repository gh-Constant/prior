import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectEditor } from "./ProjectEditor";
import type { EditableProject } from "./types";

afterEach(cleanup);

const project: EditableProject = { id: "p", name: "Launch", description: "", status: "active", areaId: null, projectType: "software", createdAt: "", updatedAt: "", deletedAt: null };

describe("ProjectEditor type and methodology", () => {
  it("shows the current kind and saves the chosen methodology with the type", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectEditor project={project} onSave={onSave} onClose={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Project type" });
    expect(select).toHaveValue("kanban");
    fireEvent.change(select, { target: { value: "scrum" } });
    expect(screen.getByText("Sprints, story points and Planning Poker for the team.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectType: "software", methodology: "scrum" }));
  });

  it("switches to standard without writing a methodology", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ProjectEditor project={project} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Project type" }), { target: { value: "standard" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = (onSave.mock.calls[0] as unknown as [EditableProject])[0];
    expect(saved.projectType).toBe("standard");
    expect(saved).not.toHaveProperty("methodology");
  });
});
