// The first-run setup (specs/GAMIFICATION.md §1). New accounts go through
// welcome → profile → experience → [player setup → egg] → first win → done.
// Returning accounts only choose their experience. Choices are saved as soon
// as they're made, so leaving halfway keeps them.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../../lib/api";
import { getToken, type SessionUser } from "../../../lib/auth";
import { LANGUAGES, useI18n, type Language } from "../../../lib/i18n";
import { gameStore } from "../../../lib/gamification/gameStore";
import type { GameVisibility } from "../../../lib/gamification/state";
import type { EffectsIntensity } from "../../../lib/gamification/types";
import { setThemePreference, useThemePreference, type ThemePreference } from "../../../lib/theme";
import type { Task } from "../../../types";
import { BrandMark } from "../../BrandMark";
import { CustomSelect } from "../../CustomSelect";
import { Icon } from "../../Icon";
import { XpBar } from "../fx/XpBar";
import { GamePreferenceFields, GameSegmented, HandleField, normalizeHandle, useHandleStatus } from "../GameIdentityFields";
import { Nameplate } from "../identity/Nameplate";
import { Pet } from "../pet";
import "../GameForm.css";
import "./OnboardingFlow.css";

/** Must match store.OnboardingVersion on the server. */
export const ONBOARDING_VERSION = 1;

type Step = "welcome" | "returning" | "profile" | "experience" | "setup" | "egg" | "firstWin" | "done";

type Props = {
  readonly user: SessionUser;
  /** The account already has work: skip the introduction and the first win. */
  readonly returning: boolean;
  readonly onUserUpdated: (user: SessionUser) => void;
  readonly onCreateTasks: (titles: string[]) => Promise<Task[]>;
  readonly onCompleteTask: (task: Task) => Promise<void>;
  readonly onFinish: () => void;
  /** Closes the flow for this session without finishing it. */
  readonly onLater: () => void;
};

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function OnboardingFlow({ user, returning, onUserUpdated, onCreateTasks, onCompleteTask, onFinish, onLater }: Props) {
  const { t, lang, setLang } = useI18n();
  const themePreference = useThemePreference();
  const [experience, setExperience] = useState<"calm" | "gamified" | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState(user.displayName);
  const [handle, setHandle] = useState("");
  const [visibility, setVisibility] = useState<GameVisibility>("hidden");
  const [effects, setEffects] = useState<EffectsIntensity>("full");
  const [sounds, setSounds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(["", "", ""]);
  const [created, setCreated] = useState<Task[]>([]);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const handleStatus = useHandleStatus(handle, null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const steps: Step[] = returning
    ? ["returning", ...(experience === "gamified" ? (["setup", "egg"] as const) : []), "done"]
    : ["welcome", "profile", "experience", ...(experience === "gamified" ? (["setup", "egg"] as const) : []), "firstWin", "done"];
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // Move focus to each new step's heading for keyboard and screen-reader users.
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setStepIndex((index) => index + 1);
    } catch {
      setError(t("onboarding.error"));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== user.displayName) {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      onUserUpdated(await api.updateProfile(trimmed, token));
    }
  }

  /** Calm finishes onboarding right away; Gamified finishes after the player setup. */
  async function saveExperience(choice: "calm" | "gamified") {
    if (choice === "calm") await gameStore.updateSettings({ onboardingVersion: ONBOARDING_VERSION, enabled: false, timeZone: timeZone() });
  }

  async function savePlayer() {
    await gameStore.updateSettings({ onboardingVersion: ONBOARDING_VERSION, enabled: true, visibility, effects, sounds, timeZone: timeZone() });
    const wanted = normalizeHandle(handle);
    if (wanted && handleStatus === "available") await gameStore.setHandle(wanted);
  }

  async function addTasks(event: FormEvent) {
    event.preventDefault();
    const titles = drafts.map((draft) => draft.trim()).filter(Boolean);
    if (!titles.length) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await onCreateTasks(titles));
    } catch {
      setError(t("onboarding.error"));
    } finally {
      setBusy(false);
    }
  }

  async function complete(task: Task) {
    if (completedId) return;
    setCompletedId(task.id);
    try {
      await onCompleteTask(task);
    } catch {
      setCompletedId(null);
      setError(t("onboarding.error"));
    }
  }

  const back = stepIndex > 0 && step !== "done" && step !== "firstWin"
    ? <button type="button" className="onboarding-back" onClick={() => { setError(null); setStepIndex((index) => index - 1); }} disabled={busy}><Icon name="chevron-left" />{t("onboarding.back")}</button>
    : <span />;

  let body: ReactNode;
  let primary: ReactNode;
  switch (step) {
    case "welcome":
      body = (
        <>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{user.displayName ? t("onboarding.welcome.title", { name: user.displayName.split(" ")[0] }) : t("onboarding.welcome.titleNoName")}</h1>
          <p className="onboarding-lead">{t("onboarding.welcome.body")}</p>
          <ul className="onboarding-points">
            <li><Icon name="grid" />{t("onboarding.welcome.matrix")}</li>
            <li><Icon name="refresh" />{t("onboarding.welcome.sync")}</li>
            <li><Icon name="user" />{t("onboarding.welcome.together")}</li>
          </ul>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" onClick={() => setStepIndex(1)}>{t("onboarding.next")}</button>;
      break;
    case "profile":
      body = (
        <>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("onboarding.profile.title")}</h1>
          <div className="onboarding-fields">
            <label className="game-field">
              <span className="game-field-label">{t("onboarding.profile.name")}</span>
              <input className="onboarding-input" value={name} maxLength={80} autoComplete="name" onChange={(event) => setName(event.target.value)} />
              <span className="game-field-hint">{t("onboarding.profile.nameHint")}</span>
            </label>
            <div className="game-field">
              <span className="game-field-label">{t("onboarding.profile.language")}</span>
              <CustomSelect
                id="onboarding-language"
                ariaLabel={t("onboarding.profile.language")}
                value={lang}
                onChange={(next) => setLang(next as Language)}
                options={LANGUAGES.map((entry) => ({ value: entry.code, label: entry.nativeName }))}
              />
            </div>
            <div className="game-field">
              <span className="game-field-label">{t("onboarding.profile.appearance")}</span>
              <GameSegmented<ThemePreference>
                label={t("onboarding.profile.appearance")}
                value={themePreference}
                onChange={setThemePreference}
                options={(["system", "light", "dark"] as const).map((value) => ({ value, label: t(`onboarding.profile.appearanceOptions.${value}`) }))}
              />
            </div>
          </div>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" disabled={busy} onClick={() => void run(saveProfile)}>{busy ? t("onboarding.saving") : t("onboarding.next")}</button>;
      break;
    case "returning":
    case "experience":
      body = (
        <>
          {step === "returning" && <span className="onboarding-eyebrow">{t("onboarding.returning.eyebrow")}</span>}
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{step === "returning" ? t("onboarding.returning.title") : t("onboarding.experience.title")}</h1>
          <p className="onboarding-lead">{step === "returning" ? t("onboarding.returning.body") : t("onboarding.experience.body")}</p>
          <div className="onboarding-choices" role="radiogroup" aria-labelledby={titleId}>
            <button type="button" role="radio" aria-checked={experience === "calm"} className={`onboarding-choice ${experience === "calm" ? "is-selected" : ""}`} onClick={() => setExperience("calm")}>
              <span className="onboarding-choice-preview onboarding-preview-calm" aria-hidden="true">
                <span className="onboarding-preview-row"><span className="onboarding-preview-check" />{t("onboarding.experience.previewTask")}</span>
                <span className="onboarding-preview-row"><span className="onboarding-preview-check is-done"><Icon name="check" /></span>{t("onboarding.experience.previewTaskTwo")}</span>
              </span>
              <strong>{t("onboarding.experience.calmTitle")}</strong>
              <span>{t("onboarding.experience.calmBody")}</span>
            </button>
            <button type="button" role="radio" aria-checked={experience === "gamified"} className={`onboarding-choice ${experience === "gamified" ? "is-selected" : ""}`} onClick={() => setExperience("gamified")}>
              <span className="onboarding-choice-preview onboarding-preview-game" aria-hidden="true">
                <span className="onboarding-preview-player">
                  <Pet species="mochi" stage="baby" mood="happy" size={44} decorative />
                  <Nameplate name={t("onboarding.experience.previewName")} effect="gold" size="sm" />
                </span>
                <XpBar compact level={7} xpInLevel={96} xpForLevel={130} unitLabel={t("game.xp.unit")} />
              </span>
              <strong>{t("onboarding.experience.gamifiedTitle")}</strong>
              <span>{t("onboarding.experience.gamifiedBody")}</span>
            </button>
          </div>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" disabled={!experience || busy} onClick={() => experience && void run(() => saveExperience(experience))}>{busy ? t("onboarding.saving") : t("onboarding.next")}</button>;
      break;
    case "setup":
      body = (
        <>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("onboarding.setup.title")}</h1>
          <p className="onboarding-lead">{t("onboarding.setup.body")}</p>
          <div className="onboarding-fields">
            <HandleField value={handle} current={null} status={handleStatus} onChange={setHandle} hint={t("onboarding.setup.handleOptional")} />
            <GamePreferenceFields visibility={visibility} effects={effects} sounds={sounds} onVisibility={setVisibility} onEffects={setEffects} onSounds={setSounds} />
          </div>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" disabled={busy || handleStatus === "checking" || (Boolean(handle.trim()) && handleStatus !== "available")} onClick={() => void run(savePlayer)}>{busy ? t("onboarding.saving") : t("onboarding.next")}</button>;
      break;
    case "egg":
      body = (
        <>
          <div className="onboarding-egg" aria-hidden="true"><Pet species="mochi" stage="egg" mood="content" mysteryEgg size={220} decorative /></div>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("onboarding.egg.title")}</h1>
          <p className="onboarding-lead">{t("onboarding.egg.body")}</p>
          <p className="onboarding-note">{t("onboarding.egg.hint")}</p>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" onClick={() => setStepIndex((index) => index + 1)}>{t("onboarding.next")}</button>;
      break;
    case "firstWin":
      body = (
        <>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("onboarding.firstWin.title")}</h1>
          <p className="onboarding-lead">{created.length ? t("onboarding.firstWin.check") : t("onboarding.firstWin.body")}</p>
          {!created.length ? (
            <form className="onboarding-fields" onSubmit={(event) => void addTasks(event)} id="onboarding-first-win">
              {drafts.map((draft, index) => (
                <input
                  key={index}
                  className="onboarding-input"
                  value={draft}
                  maxLength={200}
                  placeholder={t("onboarding.firstWin.placeholder")}
                  aria-label={`${t("onboarding.firstWin.placeholder")} ${index + 1}`}
                  autoFocus={index === 0}
                  onChange={(event) => setDrafts((current) => current.map((value, position) => position === index ? event.target.value : value))}
                />
              ))}
            </form>
          ) : (
            <ul className="onboarding-tasks">
              {created.map((task) => (
                <li key={task.id}>
                  <button type="button" className={`onboarding-task complete-control ${completedId === task.id ? "is-done" : ""}`} aria-pressed={completedId === task.id} disabled={Boolean(completedId)} onClick={() => void complete(task)}>
                    <span className="onboarding-task-check" aria-hidden="true">{completedId === task.id && <Icon name="check" />}</span>
                    <span>{task.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {completedId && <p className="onboarding-celebrate" role="status">{t("onboarding.firstWin.completed")}</p>}
        </>
      );
      primary = !created.length
        ? <button type="submit" form="onboarding-first-win" className="game-button game-button-primary" disabled={busy || !drafts.some((draft) => draft.trim())}>{busy ? t("onboarding.saving") : t("onboarding.firstWin.add")}</button>
        : <button type="button" className="game-button game-button-primary" disabled={!completedId} onClick={() => setStepIndex((index) => index + 1)}>{t("onboarding.next")}</button>;
      break;
    case "done":
      body = (
        <>
          <div className="onboarding-done" aria-hidden="true"><Icon name="check" /></div>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("onboarding.done.title")}</h1>
          <p className="onboarding-lead">{experience === "gamified" ? t("onboarding.done.gamified") : t("onboarding.done.calm")}</p>
        </>
      );
      primary = <button type="button" className="game-button game-button-primary" onClick={onFinish} autoFocus>{t("onboarding.finish")}</button>;
      break;
  }

  const secondary = step === "firstWin" && !completedId
    ? <button type="button" className="onboarding-link" onClick={() => setStepIndex((index) => index + 1)}>{t("onboarding.firstWin.skip")}</button>
    : null;

  return (
    <main className="onboarding" aria-label={t("onboarding.label")}>
      <header className="onboarding-top">
        <BrandMark withTitle />
        {step !== "done" && <button type="button" className="onboarding-link" onClick={onLater}>{t("onboarding.later")}</button>}
      </header>
      <section className="onboarding-card" aria-labelledby={titleId}>
        <div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIndex + 1} aria-valuetext={t("onboarding.progress", { current: stepIndex + 1, total: steps.length })}>
          {steps.map((entry, index) => <span key={entry} className={index <= stepIndex ? "is-reached" : ""} />)}
        </div>
        <div className="onboarding-body" key={step}>{body}</div>
        {error && <p className="onboarding-error" role="alert">{error}</p>}
        <footer className="onboarding-actions">
          {back}
          <span className="onboarding-actions-end">{secondary}{primary}</span>
        </footer>
      </section>
    </main>
  );
}
