// Settings → Game: the Calm/Gamified switch and the player's identity and
// feel. Every change saves right away; a failure puts the old value back.
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { gameStore, useGame } from "../../lib/gamification/gameStore";
import type { GameSettingsPatch, GameVisibility } from "../../lib/gamification/state";
import type { EffectsIntensity } from "../../lib/gamification/types";
import { GamePreferenceFields, GameSegmented, HandleField, normalizeHandle, useHandleStatus } from "./GameIdentityFields";
import "./GameForm.css";

/** Asks the app to show the welcome tour again. */
export const REPLAY_ONBOARDING_EVENT = "prior:replay-onboarding";

export function GameSettingsPanel() {
  const { t } = useI18n();
  const { profile } = useGame();
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [savingHandle, setSavingHandle] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const handleStatus = useHandleStatus(handle, profile?.handle ?? null);
  const experienceId = useId();
  const identityId = useId();

  useEffect(() => { setHandle(profile?.handle ?? ""); }, [profile?.handle]);

  if (!profile) {
    return <p className="game-settings-message">{t("game.settings.offline")}</p>;
  }

  async function save(patch: GameSettingsPatch) {
    setMessage(null);
    try {
      await gameStore.updateSettings(patch);
    } catch {
      setMessage({ tone: "error", text: t("game.settings.saveFailed") });
    }
  }

  async function saveHandle() {
    setSavingHandle(true);
    setMessage(null);
    try {
      await gameStore.setHandle(normalizeHandle(handle));
      setMessage({ tone: "ok", text: t("game.settings.handleSaved") });
    } catch {
      setMessage({ tone: "error", text: t("game.settings.handleErrors.generic") });
    } finally {
      setSavingHandle(false);
    }
  }

  return (
    <>
      <section className="settings-section" aria-labelledby={experienceId}>
        <h2 id={experienceId} className="settings-section-title">{t("game.settings.experience")}</h2>
        <div className="settings-group">
          <div className="settings-row is-stacked">
            <div className="settings-row-text">
              <div className="settings-row-description">{t("game.settings.experienceHint")}</div>
            </div>
            <div className="settings-row-control">
              <GameSegmented<"calm" | "gamified">
                label={t("game.settings.experience")}
                value={profile.enabled ? "gamified" : "calm"}
                onChange={(value) => void save({ enabled: value === "gamified" })}
                options={[{ value: "calm", label: t("game.settings.calm") }, { value: "gamified", label: t("game.settings.gamified") }]}
              />
            </div>
          </div>
          <div className="settings-group-footer"><span className="settings-row-description">{profile.enabled ? t("game.settings.gamifiedHint") : `${t("game.settings.calmHint")} ${t("game.settings.calmNote")}`}</span></div>
        </div>
      </section>

      {profile.enabled && (
        <section className="settings-section" aria-labelledby={identityId}>
          <h2 id={identityId} className="settings-section-title">{t("game.settings.identity")}</h2>
          <div className="settings-group game-settings-fields">
            <HandleField value={handle} current={profile.handle} status={handleStatus} onChange={setHandle} onSave={() => void saveHandle()} saving={savingHandle} />
            <GamePreferenceFields
              visibility={profile.visibility}
              effects={profile.effects}
              sounds={profile.sounds}
              onVisibility={(visibility: GameVisibility) => void save({ visibility })}
              onEffects={(effects: EffectsIntensity) => void save({ effects })}
              onSounds={(sounds) => void save({ sounds })}
            />
          </div>
        </section>
      )}

      {message && <p className={`game-settings-message ${message.tone === "error" ? "is-error" : "is-ok"}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}

      <button type="button" className="game-button game-settings-replay" onClick={() => window.dispatchEvent(new Event(REPLAY_ONBOARDING_EVENT))}>{t("game.settings.replayOnboarding")}</button>
    </>
  );
}
