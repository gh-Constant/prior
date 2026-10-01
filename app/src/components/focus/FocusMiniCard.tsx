import { useEffect, useState } from "react";
import type { Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { formatCountdown, phaseProgress, remainingMs, usePomodoro } from "../../lib/pomodoro";
import { Icon } from "../Icon";
import { PauseGlyph, PlayGlyph, toggleTimer } from "./FocusView";

type Props = {
  readonly tasks: readonly Task[];
  readonly onOpen: () => void;
};

/** Today's shortcut to the Focus page: the live countdown, play/pause, and the task in focus. */
export function FocusMiniCard({ tasks, onOpen }: Props) {
  const { t } = useI18n();
  const state = usePomodoro();
  const running = state.endsAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const task = state.taskId ? tasks.find((item) => item.id === state.taskId) : undefined;
  const progress = phaseProgress(state, now);

  return (
    <section className={`today-card focus-mini is-${state.phase} ${running ? "is-running" : ""}`} aria-labelledby="today-focus-title">
      <button type="button" className="focus-mini-play" aria-label={running ? t("focus.pause") : t("focus.start")} onClick={toggleTimer} style={{ ["--progress" as string]: `${progress * 360}deg` }}>
        <span>{running ? <PauseGlyph /> : <PlayGlyph />}</span>
      </button>
      <button type="button" className="focus-mini-main" onClick={onOpen}>
        <span id="today-focus-title" className="focus-mini-label">{t(`focus.phase.${state.phase}`)} · <time>{formatCountdown(remainingMs(state, now))}</time></span>
        <span className="focus-mini-task">{task?.title ?? t("focus.mini.noTask")}</span>
      </button>
      <button type="button" className="today-ghost-button focus-mini-open" aria-label={t("focus.mini.open")} title={t("focus.mini.open")} onClick={onOpen}><Icon name="chevron-right" /></button>
    </section>
  );
}
