import type { DictationStatus } from "../hooks/useDictation";
import { Icon } from "./Icon";

type ControlsProps = {
  status: DictationStatus;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
};

type PreviewProps = {
  finalText: string;
  interimText: string;
  warning: string | null;
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

export function DictationControls({ status, onStart, onStop, onCancel }: ControlsProps) {
  const active = status === "preparing" || status === "listening" || status === "stopping";

  return (
    <div className={`dictation-controls ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="dictation-icon-button"
        onClick={active ? onStop : onStart}
        disabled={status === "unavailable" || status === "preparing" || status === "stopping"}
        aria-label={active ? "Stop dictation" : "Start dictation"}
        title={active ? "Stop dictation" : "Start dictation"}
      >
        <Icon name={active ? "stop" : "microphone"} />
      </button>
      {active && (
        <button type="button" className="dictation-cancel-icon" onClick={onCancel} aria-label="Cancel dictation" title="Cancel dictation">
          <Icon name="close" />
        </button>
      )}
      <span className="dictation-sr-status" role="status" aria-live="polite">{statusLabel(status)}</span>
    </div>
  );
}

export function DictationPreview({ finalText, interimText, warning }: PreviewProps) {
  if (!finalText && !interimText && !warning) return null;
  return (
    <div className="dictation-preview" aria-label="Dictation preview">
      {(finalText || interimText) && <span className="dictation-preview-label">Live preview</span>}
      <span>{finalText}</span><span className="dictation-interim">{interimText}</span>
      {warning && <span className="dictation-warning">{warning}</span>}
    </div>
  );
}
