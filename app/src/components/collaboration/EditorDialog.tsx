import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Modal } from "../Modal";
import "./Collaboration.css";

/** Shared save lifecycle: retain drafts on failure and prevent duplicate submissions. */
export function EditorDialog({ title, children, onSave, onClose, invalid = false }: {
  title: string; children: ReactNode; onSave: () => Promise<void>; onClose: () => void; invalid?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const close = useCallback(() => { if (!pending.current) onClose(); }, [onClose]);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const elements = form.current?.closest("[role=dialog]")?.querySelectorAll<HTMLElement>("button:enabled, input:enabled, select:enabled, textarea:enabled");
    if (!elements?.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div onKeyDown={trapFocus}><Modal title={title} onClose={close} maxWidth={600}>
    <form ref={form} className="collab-editor" aria-busy={busy} onSubmit={async (event) => {
      event.preventDefault();
      if (pending.current || invalid) return;
      pending.current = true;
      setBusy(true);
      setError("");
      try { await onSave(); pending.current = false; onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save. Please try again."); }
      finally { pending.current = false; setBusy(false); }
    }}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && <p className="collab-error" role="alert">{error}</p>}
      <div className="collab-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary-button" disabled={busy || invalid}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </Modal></div>;
}
