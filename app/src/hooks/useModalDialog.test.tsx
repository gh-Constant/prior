import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useModalDialog } from "./useModalDialog";

describe("useModalDialog", () => {
  it("opens the dialog with showModal when available and closes on unmount", () => {
    const dialog = document.createElement("dialog");
    const showModal = vi.fn();
    const close = vi.fn(() => {
      Object.defineProperty(dialog, "open", { configurable: true, value: false });
    });
    dialog.showModal = showModal;
    dialog.close = close;
    Object.defineProperty(dialog, "open", { configurable: true, value: false });
    document.body.appendChild(dialog);

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDialogElement | null>(null);
      ref.current = dialog;
      useModalDialog(ref);
    });

    expect(showModal).toHaveBeenCalledTimes(1);
    Object.defineProperty(dialog, "open", { configurable: true, value: true });
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
    dialog.remove();
  });

  it("falls back to the open attribute when showModal is unavailable", () => {
    const dialog = document.createElement("dialog");
    dialog.showModal = undefined as unknown as () => void;
    const setAttribute = vi.spyOn(dialog, "setAttribute");
    document.body.appendChild(dialog);

    renderHook(() => {
      const ref = useRef<HTMLDialogElement | null>(null);
      ref.current = dialog;
      useModalDialog(ref);
    });

    expect(setAttribute).toHaveBeenCalledWith("open", "");
    dialog.remove();
  });
});
