import { useEffect, useRef, useState } from "react";
import { getUser } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { localStore } from "../lib/localStore";
import { QUICK_TASK_CREATED_EVENT } from "../lib/quickCapture";
import { Icon } from "./Icon";
import "./QuickAddWindow.css";

async function hideWindow(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quick_add_hide");
  } catch {
    // Browser preview: nothing to hide.
  }
}

async function announceCreated(taskId: string): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(QUICK_TASK_CREATED_EVENT, { taskId });
  } catch {
    window.dispatchEvent(new CustomEvent(QUICK_TASK_CREATED_EVENT, { detail: { taskId } }));
  }
}

/**
 * The desktop quick-add window: a title, Important/Urgent toggles, Enter to
 * save, Esc to close. The task goes through the same local store and outbox
 * as the main window, which then syncs it.
 */
export function QuickAddWindow() {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("quick-add-document");
    inputRef.current?.focus();
    const refocus = () => window.setTimeout(() => inputRef.current?.focus(), 0);
    window.addEventListener("focus", refocus);
    return () => window.removeEventListener("focus", refocus);
  }, []);

  function reset() {
    setTitle("");
    setImportant(false);
    setUrgent(false);
    setError("");
  }

  async function save() {
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = getUser();
      const task = await localStore.saveTask({ title: clean, important, urgent, status: "inbox", peopleIds: user ? [user.id] : [] });
      await announceCreated(task.id);
      reset();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
      await hideWindow();
    } catch {
      setError(t("capture.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="quick-add" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); reset(); void hideWindow(); } }}>
      <form className="quick-add-form" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label={t("capture.label")}>
        <div className="quick-add-row" data-tauri-drag-region>
          <Icon name="plus" aria-hidden="true" />
          <input
            ref={inputRef}
            value={title}
            maxLength={400}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("capture.placeholder")}
            aria-label={t("capture.title")}
            autoComplete="off"
            spellCheck
          />
        </div>
        <div className="quick-add-actions">
          <button type="button" className={`quick-add-flag important ${important ? "on" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}>
            <Icon name="star" />{t("tasks.composer.important")}
          </button>
          <button type="button" className={`quick-add-flag urgent ${urgent ? "on" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}>
            <Icon name="bolt" />{t("tasks.composer.urgent")}
          </button>
          <span className="quick-add-status" role="status" aria-live="polite">{error || (saved ? t("capture.saved") : t("capture.hint"))}</span>
          <button type="submit" className="primary-button" disabled={busy || !title.trim()}>{t("capture.save")}</button>
        </div>
      </form>
    </main>
  );
}
