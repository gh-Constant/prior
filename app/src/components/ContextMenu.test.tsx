import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, isEditableTarget, useContextMenu, type ContextMenuItem } from "./ContextMenu";

afterEach(() => cleanup());

function items(overrides: Partial<ContextMenuItem> = {}): ContextMenuItem[] {
  return [
    { label: "Edit", icon: "pencil", run: vi.fn(), ...overrides },
    { label: "Delete", icon: "trash", danger: true, run: vi.fn() },
  ];
}

describe("ContextMenu", () => {
  it("opens at the cursor, runs the chosen action, then closes", () => {
    const onClose = vi.fn();
    const menuItems = items();
    render(<ContextMenu x={120} y={80} items={menuItems} onClose={onClose} />);

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveStyle({ top: "80px", left: "120px" });

    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(menuItems[0]?.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on outside click", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items()} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector(".context-menu-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("never overflows the viewport", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={window.innerWidth + 100} y={window.innerHeight + 100} items={items()} onClose={onClose} />);
    const menu = screen.getByRole("menu");
    const top = Number.parseFloat(menu.style.top);
    const left = Number.parseFloat(menu.style.left);
    expect(top).toBeLessThan(window.innerHeight);
    expect(left).toBeLessThan(window.innerWidth);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it("keeps native menus inside editable fields", () => {
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("useContextMenu suppresses the native menu except in editable fields", () => {
    const opened: Array<{ x: number; y: number }> = [];
    function Harness() {
      const { menu, openMenu, closeMenu } = useContextMenu();
      return (
        <div
          data-testid="target"
          onContextMenu={(event) => {
            if (openMenu(event, items())) opened.push({ x: event.clientX, y: event.clientY });
          }}
        >
          {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
          <input aria-label="editable" />
        </div>
      );
    }
    render(<Harness />);
    const target = screen.getByTestId("target");

    fireEvent.contextMenu(target, { clientX: 50, clientY: 60 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(opened).toHaveLength(1);

    fireEvent.click(document.querySelector(".context-menu-overlay")!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const editable = screen.getByLabelText("editable");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    const prevented = !editable.dispatchEvent(event);
    // Dispatching through the real DOM keeps the native behavior: our handler
    // must not preventDefault inside an input.
    expect(prevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
