import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dragCard } from "../../test/kanbanDrag";
import { KanbanBoard, type KanbanColumn } from "./KanbanBoard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // A cancelled drag animates its ghost back before removing it.
  document.querySelectorAll(".kanban-ghost").forEach((ghost) => ghost.remove());
});

type Item = { id: string; title: string };
const item = (id: string): Item => ({ id, title: `Card ${id}` });

function columns(overrides: Partial<Record<string, Partial<KanbanColumn<Item>>>> = {}): KanbanColumn<Item>[] {
  return [
    { id: "todo", label: "Todo", items: [item("a"), item("b")], canAdd: true, ...overrides.todo },
    { id: "doing", label: "Doing", items: [], ...overrides.doing },
    { id: "done", label: "Done", items: [item("c"), item("d"), item("e"), item("f")], previewCount: 2, ...overrides.done },
  ];
}

function renderBoard(props: Partial<Parameters<typeof KanbanBoard<Item>>[0]> = {}) {
  const onMove = vi.fn(async () => {});
  const onAdd = vi.fn();
  const utils = render(
    <KanbanBoard<Item>
      columns={columns()}
      label="Board"
      emptyLabel="Nothing here"
      onMove={onMove}
      onAdd={onAdd}
      renderCard={(card) => <button type="button" className="board-card-open" onClick={() => undefined}>{card.title}</button>}
      {...props}
    />,
  );
  return { ...utils, onMove, onAdd };
}

const column = (name: string) => screen.getByRole("region", { name });
const card = (title: string) => screen.getByText(title).closest("article") as HTMLElement;

describe("KanbanBoard", () => {
  it("renders every column with its cards, counts and phone pills", () => {
    renderBoard();
    expect(within(column("Todo")).getByText("Card a")).toBeInTheDocument();
    expect(within(column("Doing")).getByText("Nothing here")).toBeInTheDocument();
    const pills = screen.getByRole("navigation", { name: "Columns" });
    expect(within(pills).getAllByRole("button").map((pill) => pill.textContent)).toEqual(["Todo2", "Doing0", "Done4"]);
  });

  it("shows a collapsed preview of long columns and expands it", () => {
    renderBoard();
    expect(within(column("Done")).queryByText("Card e")).not.toBeInTheDocument();
    fireEvent.click(within(column("Done")).getByRole("button", { name: "+2 more" }));
    expect(within(column("Done")).getByText("Card f")).toBeInTheDocument();
    fireEvent.click(within(column("Done")).getByRole("button", { name: "Show less" }));
    expect(within(column("Done")).queryByText("Card f")).not.toBeInTheDocument();
  });

  it("creates a card in a column with its + button", () => {
    const { onAdd } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Todo" }));
    expect(onAdd).toHaveBeenCalledWith("todo");
  });

  it("moves a card dragged with the mouse, highlighting the column under it", () => {
    const { onMove } = renderBoard();
    const target = column("Doing");
    dragCard(card("Card a"), target, { hover: () => expect(target).toHaveClass("is-drop-target") });
    expect(onMove).toHaveBeenCalledWith("a", "doing");
    expect(document.querySelector(".kanban-ghost")).toBeNull();
  });

  it("moves a card dropped on a column pill", () => {
    const { onMove } = renderBoard();
    const pill = within(screen.getByRole("navigation", { name: "Columns" })).getByRole("button", { name: /Done/ });
    dragCard(card("Card b"), pill, { hover: () => expect(pill).toHaveClass("is-drop-target") });
    expect(onMove).toHaveBeenCalledWith("b", "done");
  });

  it("does nothing when dropped on its own column or outside the board", () => {
    const { onMove } = renderBoard();
    dragCard(card("Card a"), column("Todo"));
    dragCard(card("Card a"), document.body);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("refuses columns that cannot receive cards", () => {
    const { onMove } = renderBoard({ columns: columns({ doing: { canDrop: false } }) });
    dragCard(card("Card a"), column("Doing"));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Move to Doing/ })).not.toBeInTheDocument();
  });

  it("does not start a drag from the completion circle or when dragging is off", () => {
    const withCircle = (card: Item) => <><button type="button" data-kanban-nodrag aria-label={`Complete ${card.title}`} /><span>{card.title}</span></>;
    const { onMove, rerender } = renderBoard({ renderCard: withCircle });
    dragCard(screen.getByLabelText("Complete Card a"), column("Doing"));
    expect(onMove).not.toHaveBeenCalled();
    rerender(<KanbanBoard<Item> columns={columns()} label="Board" emptyLabel="x" onMove={onMove} canDrag={() => false} renderCard={(c) => <span>{c.title}</span>} />);
    expect(card("Card a")).toHaveAttribute("data-draggable", "false");
    dragCard(card("Card a"), column("Doing"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("cancels a drag with Escape", () => {
    const { onMove } = renderBoard();
    const target = column("Doing");
    dragCard(card("Card a"), target, {
      drop: false,
      hover: () => {
        expect(document.querySelector(".kanban-ghost")).not.toBeNull();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(document.querySelector(".kanban-card.is-drag-source")).toBeNull();
      },
    });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: 80, clientY: 80 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("shows the reason when a move is rejected", async () => {
    renderBoard({ onMove: vi.fn().mockRejectedValue(new Error("Read-only project")) });
    dragCard(card("Card a"), column("Doing"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Read-only project");
  });

  it("offers Move to … in the card menu, which is how keyboard users move cards", async () => {
    const { onMove } = renderBoard({ menuItems: (card) => [{ icon: "pencil", label: `Edit ${card.title}`, run: vi.fn() }] });
    fireEvent.contextMenu(card("Card a"), { clientX: 20, clientY: 20 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Edit Card a" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Move to Todo" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Move to Doing" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("a", "doing"));
  });

  describe("touch", () => {
    it("starts a drag only after the long-press, then drops on a pill", () => {
      vi.useFakeTimers();
      const { onMove } = renderBoard();
      const pill = within(screen.getByRole("navigation", { name: "Columns" })).getByRole("button", { name: /Doing/ });
      dragCard(card("Card a"), pill, { pointerType: "touch" });
      expect(onMove).toHaveBeenCalledWith("a", "doing");
    });

    it("treats an early move as scrolling and never starts a drag", () => {
      vi.useFakeTimers();
      const { onMove } = renderBoard();
      const original = document.elementFromPoint;
      document.elementFromPoint = vi.fn(() => column("Doing"));
      fireEvent.pointerDown(card("Card a"), { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 60 });
      act(() => { vi.advanceTimersByTime(400); });
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 90 });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 90 });
      document.elementFromPoint = original;
      expect(onMove).not.toHaveBeenCalled();
      expect(document.querySelector(".kanban-ghost")).toBeNull();
    });

    it("opens the card menu when the long-press is released without moving", () => {
      vi.useFakeTimers();
      const { onMove } = renderBoard();
      fireEvent.pointerDown(card("Card a"), { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(350); });
      expect(card("Card a")).toHaveClass("is-armed");
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(onMove).not.toHaveBeenCalled();
    });
  });
});
