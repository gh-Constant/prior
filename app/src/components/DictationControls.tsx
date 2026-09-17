import type { DictationStatus } from "../hooks/useDictation";
import { Icon } from "./Icon";

type ControlsProps = {
  readonly status: DictationStatus;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly disabled?: boolean;
  readonly disabledTitle?: string;
};

type StatusBarProps = {
  readonly status: DictationStatus;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onDismissError: () => void;
};

type PreviewProps = {
  readonly finalText: string;
  readonly interimText: string;
  readonly warning: string | null;
};

function statusLabel(status: DictationStatus): string {
  switch (status) {
    case "preparing": return "Requesting microphone access";
    case "listening": return "Recording audio";
    case "stopping": return "Transcribing audio";
    case "review": return "Transcription inserted; review and edit before sending";
    case "error": return "Voice input failed; you can continue typing";
    case "unavailable": return "Voice input is unavailable in this app or browser";
    default: return "Start voice input";
  }
}

export function DictationControls({ status, onStart, onStop, disabled = false, disabledTitle }: ControlsProps) {
  const active = status === "preparing" || status === "listening" || status === "stopping";

  return (
    <div className={`dictation-controls ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="dictation-icon-button"
        onClick={active ? onStop : onStart}
        disabled={disabled || status === "unavailable" || status === "preparing" || status === "stopping"}
        aria-label={active ? "Stop recording" : "Start voice input"}
        title={disabled ? disabledTitle : active ? "Stop recording and transcribe" : "Start voice input"}
      >
        <Icon name={active ? "stop" : "microphone"} />
      </button>
      <span className="dictation-sr-status" role="status" aria-live="polite">{statusLabel(status)}</span>
    </div>
  );
}

function listeningLabel(status: DictationStatus): string {
  if (status === "preparing") return "Requesting microphone…";
  if (status === "stopping") return "Transcribing…";
  return "Recording… tap stop to transcribe";
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
        <span>{listeningLabel(status)}</span>
        <button type="button" className="dictation-cancel-text" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return null;
}

export function DictationPreview({ finalText, interimText, warning }: PreviewProps) {
  if (!finalText && !interimText && !warning) return null;
  return (
    <div className="dictation-preview" aria-label="Dictation preview">
      {(finalText || interimText) && <span className="dictation-preview-label">Transcription</span>}
      <span>{finalText}</span><span className="dictation-interim">{interimText}</span>
      {warning && <span className="dictation-warning">{warning}</span>}
    </div>
  );
}
