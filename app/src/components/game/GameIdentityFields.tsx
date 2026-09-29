// The player's public identity and feel: handle, leaderboard visibility,
// effects and sounds. Shared by onboarding and Settings → Game.
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { gameStore } from "../../lib/gamification/gameStore";
import type { GameVisibility } from "../../lib/gamification/state";
import type { EffectsIntensity } from "../../lib/gamification/types";
import "./GameForm.css";

export type HandleStatus = "idle" | "checking" | "available" | "format" | "reserved" | "blocked" | "taken" | "error";

const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Checks a handle as the player types, debounced. */
export function useHandleStatus(raw: string, current: string | null): HandleStatus {
  const [status, setStatus] = useState<HandleStatus>("idle");
  const handle = normalizeHandle(raw);
  useEffect(() => {
    if (!handle || handle === current) { setStatus("idle"); return undefined; }
    if (!HANDLE_PATTERN.test(handle)) { setStatus("format"); return undefined; }
    setStatus("checking");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      gameStore.checkHandle(handle)
        .then((result) => { if (!cancelled) setStatus(result.available ? "available" : (result.reason || "taken") as HandleStatus); })
        .catch(() => { if (!cancelled) setStatus("error"); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [handle, current]);
  return status;
}

type SegmentedProps<T extends string> = {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
};

export function GameSegmented<T extends string>({ label, value, options, onChange, disabled }: SegmentedProps<T>) {
  return (
    <div className="game-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-selected" : ""}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type HandleFieldProps = {
  readonly value: string;
  readonly current: string | null;
  readonly status: HandleStatus;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly disabled?: boolean;
  /** Renders a save button next to the field (settings); onboarding saves on Continue. */
  readonly onSave?: () => void;
  readonly saving?: boolean;
};

export function HandleField({ value, current, status, onChange, hint, disabled, onSave, saving }: HandleFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const problem = status === "format" || status === "reserved" || status === "blocked" || status === "taken" ? t(`game.settings.handleErrors.${status}`) : status === "error" ? t("game.settings.handleErrors.generic") : null;
  const canSave = Boolean(onSave) && status === "available" && !saving;
  return (
    <div className="game-field">
      <label htmlFor={id} className="game-field-label">{t("game.settings.handle")}</label>
      <div className="game-handle-row">
        <span className="game-handle-input">
          <span aria-hidden="true">@</span>
          <input
            id={id}
            value={value}
            maxLength={21}
            placeholder={t("game.settings.handlePlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && canSave) { event.preventDefault(); onSave?.(); } }}
          />
        </span>
        {onSave && <button type="button" className="game-button" disabled={!canSave} onClick={onSave}>{t("game.settings.handleSave")}</button>}
      </div>
      <span id={`${id}-hint`} className={`game-field-hint ${problem ? "is-error" : status === "available" ? "is-ok" : ""}`} aria-live="polite">
        {problem ?? (status === "available" && normalizeHandle(value) !== current ? t("game.settings.handleAvailable") : hint ?? t("game.settings.handleHint"))}
      </span>
    </div>
  );
}

type PreferencesProps = {
  readonly visibility: GameVisibility;
  readonly effects: EffectsIntensity;
  readonly sounds: boolean;
  readonly onVisibility: (value: GameVisibility) => void;
  readonly onEffects: (value: EffectsIntensity) => void;
  readonly onSounds: (value: boolean) => void;
  readonly disabled?: boolean;
};

export function GamePreferenceFields({ visibility, effects, sounds, onVisibility, onEffects, onSounds, disabled }: PreferencesProps) {
  const { t } = useI18n();
  const soundsId = useId();
  return (
    <>
      <div className="game-field">
        <span className="game-field-label">{t("game.settings.visibility")}</span>
        <GameSegmented
          label={t("game.settings.visibility")}
          value={visibility}
          disabled={disabled}
          onChange={onVisibility}
          options={(["public", "anonymous", "hidden"] as const).map((value) => ({ value, label: t(`game.settings.visibilityOptions.${value}`) }))}
        />
        <span className="game-field-hint">{t(`game.settings.visibilityDescriptions.${visibility}`)}</span>
      </div>
      <div className="game-field">
        <span className="game-field-label">{t("game.settings.effects")}</span>
        <GameSegmented
          label={t("game.settings.effects")}
          value={effects}
          disabled={disabled}
          onChange={onEffects}
          options={(["full", "subtle", "off"] as const).map((value) => ({ value, label: t(`game.settings.effectsOptions.${value}`) }))}
        />
        <span className="game-field-hint">{t("game.settings.effectsHint")}</span>
      </div>
      <div className="game-field game-field-inline">
        <span className="game-field-text">
          <label htmlFor={soundsId} className="game-field-label">{t("game.settings.sounds")}</label>
          <span className="game-field-hint">{t("game.settings.soundsHint")}</span>
        </span>
        <input id={soundsId} type="checkbox" role="switch" className="game-switch" checked={sounds} disabled={disabled} onChange={(event) => onSounds(event.target.checked)} />
      </div>
    </>
  );
}
