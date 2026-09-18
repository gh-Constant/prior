import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditableAvatar, EditableIcon, IconPicker, canEditAvatar, filterIconOptions } from "./IconPicker";

afterEach(cleanup);

describe("filterIconOptions", () => {
  const options = ["folder", "rocket", "target", "code", "bolt", "calendar-check"] as const;
  it("returns all options on empty query", () => {
    expect(filterIconOptions([...options], "")).toEqual([...options]);
    expect(filterIconOptions([...options], "   ")).toEqual([...options]);
  });
  it("filters case-insensitively by substring", () => {
    expect(filterIconOptions([...options], "rock")).toEqual(["rocket"]);
    expect(filterIconOptions([...options], "CAL")).toEqual(["calendar-check"]);
    expect(filterIconOptions([...options], "o")).toEqual(["folder", "rocket", "code", "bolt"]);
  });
  it("returns empty when nothing matches", () => {
    expect(filterIconOptions([...options], "zzz")).toEqual([]);
  });
});

describe("canEditAvatar permission guard", () => {
  it("requires canEdit and forbids readOnly", () => {
    expect(canEditAvatar({ canEdit: true, readOnly: false })).toBe(true);
    expect(canEditAvatar({ canEdit: true, readOnly: true })).toBe(false);
    expect(canEditAvatar({ canEdit: false, readOnly: false })).toBe(false);
    expect(canEditAvatar({})).toBe(false);
  });
});

describe("IconPicker search", () => {
  it("filters the grid as the user types", () => {
    const onSelect = vi.fn();
    render(<IconPicker value="folder" options={["folder", "rocket", "target"]} fallback="folder" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Use rocket icon" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "rock" } });
    expect(screen.queryByRole("button", { name: "Use folder icon" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use rocket icon" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use rocket icon" }));
    expect(onSelect).toHaveBeenCalledWith("rocket");
  });
  it("shows an empty state when nothing matches", () => {
    render(<IconPicker value="folder" options={["folder"]} fallback="folder" onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "zzz" } });
    expect(screen.getByText(/No icons match/)).toBeVisible();
  });
});

describe("EditableIcon / EditableAvatar permission guard", () => {
  it("renders a static preview with no overlay when read-only", () => {
    const onOpen = vi.fn();
    const { container } = render(<EditableIcon icon="rocket" fallback="folder" canEdit readOnly onOpen={onOpen} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".editable-icon-overlay")).toBeNull();
  });
  it("renders no clickable overlay without permission", () => {
    const onOpen = vi.fn();
    const { container } = render(<EditableIcon icon="rocket" fallback="folder" onOpen={onOpen} />);
    expect(container.querySelector("button")).toBeNull();
  });
  it("opens the editor on click only when editable", () => {
    const onOpen = vi.fn();
    render(<EditableIcon icon="rocket" fallback="folder" canEdit onOpen={onOpen} label="Edit project icon" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit project icon" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it("guards profile avatars the same way", () => {
    const onOpen = vi.fn();
    const person = { id: "u1", name: "Ada", avatarUrl: "https://example.com/ada.jpg" };
    const { rerender, container } = render(<EditableAvatar person={person} readOnly onOpen={onOpen} />);
    expect(container.querySelector("button")).toBeNull();
    rerender(<EditableAvatar person={person} canEdit onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ada avatar" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
