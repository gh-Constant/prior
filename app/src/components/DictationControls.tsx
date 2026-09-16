import type { DictationStatus } from "../hooks/useDictation";
import { Icon } from "./Icon";

export const DICTATION_LANGUAGES = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["es-ES", "Español"],
  ["it-IT", "Italiano"],
  ["pt-BR", "Português"],
  ["ja-JP", "日本語"],
  ["zh-CN", "中文"],
] as const;

type Props = {
  status: DictationStatus;
  language: string;
  onLanguageChange: (language: string) => void;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  finalText: string;
  interimText: string;
  notice: string | null;
  error: string | null;
  warning: string | null;
};

function statusLabel(status: DictationStatus): string {
  switch (status) {
    case "preparing": return "Requesting microphone access…";
    case "listening": return "Listening…";
    case "stopping": return "Finishing dictation…";
    case "review": return "Dictation inserted. Review and edit before sending.";
    case "error": return "Dictation needs attention.";
    case "unavailable": return "Dictation unavailable here.";
    default: return "Ready for dictation.";
  }
}

export function DictationControls({
  status,
  language,
  onLanguageChange,
  onStart,
  onStop,
  onCancel,
  finalText,
  interimText,
  notice,
  error,
  warning,
}: Props) {
  const active = status === "preparing" || status === "listening" || status === "stopping";
  const preview = Boolean(finalText || interimText);

  return (
    <div className={`dictation-controls ${active ? "is-active" : ""}`}>
      <div className="dictation-toolbar">
        {active ? (
          <>
            <button type="button" className="dictation-action dictation-stop" onClick={onStop} disabled={status === "stopping"} aria-label="Stop dictation" title="Stop dictation">
              <Icon name="stop" />
              <span>Stop</span>
            </button>
            <button type="button" className="dictation-action dictation-cancel" onClick={onCancel} aria-label="Cancel dictation" title="Cancel dictation">
              <Icon name="close" />
              <span>Cancel</span>
            </button>
          </>
        ) : (
          <button type="button" className="dictation-microphone" onClick={onStart} disabled={status === "unavailable"} aria-label="Start dictation" title="Start dictation">
            <Icon name="microphone" />
            <span>Dictate</span>
          </button>
        )}
        <label className="dictation-language">
          <span>Language</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)} disabled={active} aria-label="Dictation language">
            {DICTATION_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {!DICTATION_LANGUAGES.some(([value]) => value === language) && <option value={language}>{language}</option>}
          </select>
        </label>
      </div>

      <div className="dictation-status" role="status" aria-live="polite">{statusLabel(status)}</div>
      {notice && <div className="dictation-notice">{notice}</div>}
      {preview && (
        <div className="dictation-preview" aria-label="Dictation preview">
          <span className="dictation-preview-label">Live preview</span>
          <span>{finalText}</span><span className="dictation-interim">{interimText}</span>
        </div>
      )}
      {warning && <div className="dictation-warning">{warning}</div>}
      {error && <div className="dictation-error" role="alert">{error}</div>}
    </div>
  );
}
