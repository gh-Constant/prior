import type { DictationStatus } from "../hooks/useDictation";
import { useI18n } from "../lib/i18n";
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

function statusLabel(t: (key: string) => string, status: DictationStatus): string {
  switch (status) {
    case "preparing": return t("agent.dictation.statusPreparing");
    case "listening": return t("agent.dictation.statusListening");
    case "stopping": return t("agent.dictation.statusStopping");
    case "review": return t("agent.dictation.statusReview");
    case "error": return t("agent.dictation.statusError");
    case "unavailable": return t("agent.dictation.statusUnavailable");
    default: return t("agent.dictation.start");
  }
}

export function DictationControls({ status, onStart, onStop, disabled = false, disabledTitle }: ControlsProps) {
  const { t } = useI18n();
  const active = status === "preparing" || status === "listening" || status === "stopping";

  return (
    <div className={`dictation-controls ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="dictation-icon-button"
        onClick={active ? onStop : onStart}
        disabled={disabled || status === "unavailable" || status === "preparing" || status === "stopping"}
        aria-label={active ? t("agent.dictation.stop") : t("agent.dictation.start")}
        title={disabled ? disabledTitle : active ? t("agent.dictation.stopTranscribe") : t("agent.dictation.start")}
      >
        <Icon name={active ? "stop" : "microphone"} />
      </button>
      <span className="dictation-sr-status" role="status" aria-live="polite">{statusLabel(t, status)}</span>
    </div>
  );
}

function listeningLabel(t: (key: string) => string, status: DictationStatus): string {
  if (status === "preparing") return t("agent.dictation.requesting");
  if (status === "stopping") return t("agent.dictation.transcribing");
  return t("agent.dictation.recording");
}

export function DictationStatusBar({ status, error, onCancel, onDismissError }: StatusBarProps) {
  const { t } = useI18n();
  const active = status === "preparing" || status === "listening" || status === "stopping";

  if (status === "error" && error) {
    return (
      <div className="dictation-status-bar dictation-error" role="alert">
        <Icon name="microphone" />
        <span>{error}</span>
        <button type="button" onClick={onDismissError} aria-label={t("agent.dictation.dismiss")}>
          <Icon name="close" />
        </button>
      </div>
    );
  }

  if (active) {
    return (
      <div className="dictation-status-bar dictation-listening" role="status" aria-live="polite">
        <span className="dictation-pulse" aria-hidden="true" />
        <span>{listeningLabel(t, status)}</span>
        <button type="button" className="dictation-cancel-text" onClick={onCancel}>
          {t("agent.dictation.cancel")}
        </button>
      </div>
    );
  }

  return null;
}

export function DictationPreview({ finalText, interimText, warning }: PreviewProps) {
  const { t } = useI18n();
  if (!finalText && !interimText && !warning) return null;
  return (
    <div className="dictation-preview" aria-label={t("agent.dictation.preview")}>
      {(finalText || interimText) && <span className="dictation-preview-label">{t("agent.dictation.previewLabel")}</span>}
      <span>{finalText}</span><span className="dictation-interim">{interimText}</span>
      {warning && <span className="dictation-warning">{warning}</span>}
    </div>
  );
}
