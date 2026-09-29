import { useEffect, useState } from "react";
import type { Task } from "../types";
import { useI18n } from "../lib/i18n";
import { formatCountdown, nextPhase, pausePomodoro, readPomodoro, remainingMs, resetPomodoro, startPomodoro, writePomodoro, type PomodoroState } from "../lib/pomodoro";
import { formatEstimate } from "../lib/taskEstimate";
import { Icon } from "./Icon";

type Props = {
  recommended: Task[];
  others: Task[];
};

export function PomodoroCard({ recommended, others }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<PomodoroState>(readPomodoro);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const running = state.endsAt !== null;
  const left = remainingMs(state, now);

  const update = (next: PomodoroState) => {
    setState(next);
    writePomodoro(next);
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || left > 0) return;
    const message = state.phase === "focus" ? t("tasks.pomodoro.focusDone") : t("tasks.pomodoro.breakDone");
    update(nextPhase(state));
    setNotice(message);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Prior", { body: message });
    } catch {
      // Notifications are optional.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, left]);

  const selected = [...recommended, ...others].find((task) => task.id === state.taskId);
  const estimate = formatEstimate(selected?.estimatedMinutes);
  const toggle = () => {
    setNotice("");
    const current = Date.now();
    setNow(current);
    if (running) update(pausePomodoro(state, current));
    else {
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
      update(startPomodoro(state, current));
    }
  };

  return (
    <section className={`today-card today-pomodoro is-${state.phase}`} aria-labelledby="today-pomodoro-title">
      <div className="today-card-head is-compact">
        <div className="today-card-heading">
          <Icon name="clock" className="today-head-icon" aria-hidden="true" />
          <h3 id="today-pomodoro-title" className="today-card-title">{t("tasks.pomodoro.title")}</h3>
        </div>
        {state.sessions > 0 && <span className="today-count-pill">{t("tasks.pomodoro.sessions", { count: state.sessions })}</span>}
      </div>
      <div className="today-pomodoro-body">
        <select className="today-pomodoro-select" aria-label={t("tasks.pomodoro.task")} value={selected ? selected.id : ""} onChange={(event) => update({ ...state, taskId: event.target.value || null })}>
          <option value="">{t("tasks.pomodoro.noTask")}</option>
          {recommended.length > 0 && <optgroup label={t("tasks.pomodoro.recommended")}>{recommended.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup>}
          {others.length > 0 && <optgroup label={t("tasks.pomodoro.others")}>{others.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</optgroup>}
        </select>
        <div className="today-pomodoro-clock">
          <span className="today-pomodoro-phase">{state.phase === "focus" ? t("tasks.pomodoro.focus") : t("tasks.pomodoro.break")}</span>
          <time role="timer" aria-live="off">{formatCountdown(left)}</time>
          {estimate && <span className="today-pomodoro-estimate">{t("tasks.pomodoro.estimate", { duration: estimate })}</span>}
        </div>
        <div className="today-pomodoro-actions">
          <button type="button" className="today-pomodoro-primary" onClick={toggle}>{running ? t("tasks.pomodoro.pause") : t("tasks.pomodoro.start")}</button>
          <button type="button" className="today-ghost-button" onClick={() => { setNotice(""); update(resetPomodoro(state)); }}>{t("tasks.pomodoro.reset")}</button>
          <button type="button" className="today-ghost-button" onClick={() => { setNotice(""); update(nextPhase({ ...state, sessions: state.phase === "focus" ? state.sessions - 1 : state.sessions })); }}>{t("tasks.pomodoro.skip")}</button>
        </div>
        {notice && <p className="today-pomodoro-notice" role="status">{notice}</p>}
      </div>
    </section>
  );
}
