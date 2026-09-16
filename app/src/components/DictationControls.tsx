import type { DictationStatus } from "../hooks/useDictation";
import { Icon } from "./Icon";

type ControlsProps = {
  status: DictationStatus;
  onStart: () => void;
  onStop: () => void;
};

type StatusBarProps = {
  status: DictationStatus;
  error: string | null;
  onCancel: () => void;
  onDismissError: () => void;
};

function statusLabel(status: DictationStatus): string {
  switch (status) {
    case "preparing": return "Requesting microphone access";
    case "listening": return "Listening";
    case "stopping": return "Finishing dictation";
    case "review": return "Dictation inserted; review and edit before sending";
    case "error": return "Dictation is unavailable; you can continue typing";
    case "unavailable": return "Dictation is unavailable in this app or browser";
    default: return "Start dictation";
  }
}

export function DictationControls({ status, onStart, onStop }: ControlsProps) {
  const active = status === "preparing" || status === "listening" || status === "stopping";

  return (
    <div className={`dictation-controls ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="dictation-icon-button"
        onClick={active ? onStop : onStart}
        disabled={status === "unavailable" || status === "preparing" || status === "stopping"}
        aria-label={active ? "Stop dictation" : "Start dictation"}
        title={active ? "Stop dictation and insert text" : "Start dictation"}
      >
        <Icon name={active ? "stop" : "microphone"} />
      </button>
      <span className="dictation-sr-status" role="status" aria-live="polite">{statusLabel(status)}</span>
    </div>
  );
}

export function DictationStatusBar({ status, error, onCancel, onDismissError }: StatusBarProps) {
  const active = status === "preparing" || status === "listening" || status === "stopping";

  if (status === "error" && error) {
    return (
      <div className="dictation-status-bar dictation-error" role="alert">
        <Icon name="microphone" />
        <span>{error}</span>
        <button type="button" onClick={onDismissError} aria-label="Dismiss dictation error">
          <Icon name="close" />
        </button>
      </div>
    );
  }

  if (active) {
    return (
      <div className="dictation-status-bar dictation-listening" role="status" aria-live="polite">
        <span className="dictation-pulse" aria-hidden="true" />
        <span>{status === "preparing" ? "Requesting microphone…" : status === "stopping" ? "Finishing…" : "Listening… tap stop to insert"}</span>
        <button type="button" className="dictation-cancel-text" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return null;
}

export function DictationPreview({ finalText, interimText, warning }: { finalText: string; interimText: string; warning: string | null }) {
  if (!finalText && !interimText && !warning) return null;
  return (
    <div className="dictation-preview" aria-label="Dictation preview">
      {(finalText || interimText) && <span className="dictation-preview-label">Live preview</span>}
      <span>{finalText}</span><span className="dictation-interim">{interimText}</span>
      {warning && <span className="dictation-warning">{warning}</span>}
    </div>
  );
}
