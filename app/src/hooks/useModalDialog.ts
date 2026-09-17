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
    if (!dialog) return undefined;
    // Lock background scroll while a modal is open. Without this, touch
    // swipes chain through to the page behind the sheet and the modal
    // itself appears unscrollable on phones.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, [ref]);
}
