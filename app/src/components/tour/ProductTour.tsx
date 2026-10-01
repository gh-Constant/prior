// The product tour shown after the onboarding (and from Settings → General
// or ⌘K): first the spaces to keep in the navigation, then one slide per
// part of Prior the person chose, then a summary.
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionUser } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { DEFAULT_ENABLED_VIEWS, OPTIONAL_VIEWS, type OptionalView } from "../../lib/navigation";
import { useIsPhone } from "../../lib/useMediaQuery";
import type { WorkspaceView } from "../AppSidebar";
import { BrandMark } from "../BrandMark";
import { Icon, type IconName } from "../Icon";
import { SPACES } from "./spaces";
import { TourArt, type TourSlide } from "./TourArt";
import "./ProductTour.css";

type Step = "spaces" | TourSlide | "done";

type Props = {
  readonly user: SessionUser | null;
  /** Spaces selected when the tour opens. */
  readonly initialEnabled: readonly OptionalView[];
  readonly shortcut: { readonly newTask: string; readonly assistant: string; readonly palette: string };
  /** Saves the chosen spaces and opens a page. */
  readonly onFinish: (enabled: readonly OptionalView[], destination: WorkspaceView) => void;
  /** Leaves early; `enabled` is null when the spaces were not confirmed yet. */
  readonly onSkip: (enabled: readonly OptionalView[] | null) => void;
};

/** Slides for optional spaces, in the order they appear in the tour. */
const SPACE_SLIDES: readonly (OptionalView & TourSlide)[] = ["eisenhower", "focus", "calendar", "habits", "notes", "inbox"];

const TIP_ICONS: Record<TourSlide, readonly [IconName, IconName, IconName]> = {
  today: ["star", "calendar-check", "sparkles"],
  capture: ["plus", "tag", "zap"],
  organize: ["columns", "list-todo", "user"],
  eisenhower: ["bolt", "calendar-check", "plus"],
  focus: ["target", "refresh", "command"],
  calendar: ["calendar-check", "lock", "sliders"],
  habits: ["repeat", "check-circle", "flame"],
  notes: ["command", "folder", "list"],
  inbox: ["mail", "plus", "sparkles"],
  assistant: ["command", "check-circle", "shield"],
  palette: ["search", "arrow", "download"],
};

const SLIDE_SHORTCUT: Partial<Record<TourSlide, keyof Props["shortcut"]>> = { capture: "newTask", assistant: "assistant", palette: "palette" };

export function ProductTour({ user, initialEnabled, shortcut, onFinish, onSkip }: Props) {
  const { t, tp } = useI18n();
  const isPhone = useIsPhone();
  const [enabled, setEnabled] = useState<OptionalView[]>(() => OPTIONAL_VIEWS.filter((view) => initialEnabled.includes(view)));
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();

  const steps = useMemo<Step[]>(() => ["spaces", "today", "capture", "organize", ...SPACE_SLIDES.filter((view) => enabled.includes(view)), "assistant", "palette", "done"], [enabled]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const last = stepIndex >= steps.length - 1;

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [step]);

  const go = (delta: 1 | -1) => {
    setDirection(delta);
    setStepIndex((index) => Math.min(steps.length - 1, Math.max(0, index + delta)));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" && !last) go(1);
      else if (event.key === "ArrowLeft" && stepIndex > 0) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (view: OptionalView) => setEnabled((current) => current.includes(view) ? current.filter((item) => item !== view) : OPTIONAL_VIEWS.filter((item) => item === view || current.includes(item)));

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === "mouse") return;
    swipeStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !last) go(1);
    else if (dx > 0 && stepIndex > 0) go(-1);
  };

  const variant = isPhone ? "Phone" : "Desktop";
  const tip = (slide: TourSlide, index: number) => {
    const keyName = SLIDE_SHORTCUT[slide];
    const vars = keyName ? { shortcut: shortcut[keyName] } : undefined;
    const specific = `tour.slides.${slide}.tip${index}${variant}`;
    const text = t(specific, vars);
    return text === specific ? t(`tour.slides.${slide}.tip${index}`, vars) : text;
  };

  let body;
  if (step === "spaces") {
    body = (
      <div className="tour-spaces">
        <span className="tour-eyebrow">{t("tour.spaces.eyebrow")}</span>
        <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("tour.spaces.title")}</h1>
        <p className="tour-lead">{t("tour.spaces.body")}</p>
        <div className="tour-core">
          <span className="tour-core-label">{t("tour.spaces.always")}</span>
          <span className="tour-core-chip"><Icon name="focus" />{t("tour.spaces.core.today")}</span>
          <span className="tour-core-chip"><Icon name="list" />{t("tour.spaces.core.tasks")}</span>
          <span className="tour-core-chip"><Icon name="folder" />{t("tour.spaces.core.projects")}</span>
        </div>
        <ul className="tour-space-grid">
          {SPACES.filter((space) => space.view !== "mine" || user).map((space) => {
            const checked = enabled.includes(space.view);
            return (
              <li key={space.view}>
                <button type="button" role="checkbox" aria-checked={checked} className={`tour-space ${checked ? "is-checked" : ""}`} data-tone={space.tone} onClick={() => toggle(space.view)}>
                  <span className="tour-space-icon"><Icon name={space.icon} /></span>
                  <span className="tour-space-text">
                    <strong>{t(`tour.spaces.${space.view}.name`)}{DEFAULT_ENABLED_VIEWS.includes(space.view) && <em>{t("tour.spaces.recommended")}</em>}</strong>
                    <span>{t(`tour.spaces.${space.view}.short`)}</span>
                  </span>
                  <span className="tour-space-check" aria-hidden="true">{checked && <Icon name="check" />}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="tour-count" aria-live="polite">{tp("tour.spaces.count", enabled.length)}</p>
      </div>
    );
  } else if (step === "done") {
    body = (
      <div className="tour-done">
        <div className="tour-done-badge" aria-hidden="true"><Icon name="check" /></div>
        <span className="tour-eyebrow">{t("tour.done.eyebrow")}</span>
        <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t("tour.done.title")}</h1>
        <p className="tour-lead">{t("tour.done.body")}</p>
        <div className="tour-done-spaces" aria-label={t("tour.done.spaces")}>
          <span className="tour-core-chip"><Icon name="focus" />{t("tour.spaces.core.today")}</span>
          <span className="tour-core-chip"><Icon name="list" />{t("tour.spaces.core.tasks")}</span>
          <span className="tour-core-chip"><Icon name="folder" />{t("tour.spaces.core.projects")}</span>
          {SPACES.filter((space) => enabled.includes(space.view)).map((space) => <span key={space.view} className="tour-core-chip" data-tone={space.tone}><Icon name={space.icon} />{t(`tour.spaces.${space.view}.name`)}</span>)}
        </div>
        <p className="tour-note">{t("tour.done.replay")}</p>
      </div>
    );
  } else {
    body = (
      <div className="tour-slide">
        <div className="tour-slide-art"><TourArt slide={step} paletteShortcut={shortcut.palette} /></div>
        <div className="tour-slide-text">
          <span className="tour-eyebrow">{t(`tour.slides.${step}.eyebrow`)}</span>
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{t(`tour.slides.${step}.title`)}</h1>
          <p className="tour-lead">{t(`tour.slides.${step}.body`)}</p>
          <ul className="tour-tips">
            {TIP_ICONS[step].map((icon, index) => <li key={icon + index}><Icon name={icon} /><span>{tip(step, index + 1)}</span></li>)}
          </ul>
        </div>
      </div>
    );
  }

  const primary = last
    ? <button type="button" className="tour-primary" onClick={() => onFinish(enabled, "today")} autoFocus>{t("tour.done.start")}<Icon name="arrow" /></button>
    : <button type="button" className="tour-primary" onClick={() => go(1)}>{t("tour.next")}<Icon name="arrow" /></button>;

  return (
    <main className="tour" aria-label={t("tour.label")}>
      <header className="tour-top">
        <BrandMark withTitle />
        {!last && <button type="button" className="tour-link" onClick={() => onSkip(stepIndex > 0 ? enabled : null)}>{t("tour.skip")}</button>}
      </header>
      <section className={`tour-card ${step === "spaces" || step === "done" ? "is-narrow" : ""}`} aria-labelledby={titleId} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeStart.current = null; }}>
        <div className="tour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIndex + 1} aria-valuetext={t("tour.progress", { current: stepIndex + 1, total: steps.length })}>
          {steps.map((entry, index) => <span key={entry} className={index <= stepIndex ? "is-reached" : ""} />)}
        </div>
        <div className={`tour-body ${direction < 0 ? "is-back" : ""}`} key={step}>{body}</div>
        <footer className="tour-actions">
          {stepIndex > 0 ? <button type="button" className="tour-back" onClick={() => go(-1)}><Icon name="chevron-left" />{t("tour.back")}</button> : <span />}
          <span className="tour-actions-end">
            {last && enabled.includes("focus") && <button type="button" className="tour-secondary" onClick={() => onFinish(enabled, "focus")}><Icon name="target" />{t("tour.done.focus")}</button>}
            {primary}
          </span>
        </footer>
      </section>
      {isPhone && stepIndex === 1 && <p className="tour-swipe-hint" aria-hidden="true">{t("tour.swipeHint")}</p>}
    </main>
  );
}
