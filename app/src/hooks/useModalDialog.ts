import { useEffect, type RefObject } from "react";

/**
 * Presents a conditionally-rendered <dialog> as a true modal via showModal().
 * The component must only render the dialog when it should be visible; the
 * effect opens it on mount and closes it on unmount. Falls back to the plain
 * `open` state on engines without showModal (e.g. test environments).
 */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return undefined;
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, [ref]);
}
