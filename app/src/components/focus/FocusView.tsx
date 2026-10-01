import { useEffect, useMemo, useState } from "react";
import type { Project, Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { requestNotificationPermission } from "../../lib/notificationScheduler";
import {
  choosePhase,
  focusHistory,
  focusStatsFor,
  formatCountdown,
  pausePomodoro,
  phaseProgress,
  pomodoroStore,
  pomodoroTaskOptions,
  remainingMs,
  resetPomodoro,
  skipPhase,
  startPomodoro,
  usePomodoro,
  type PomodoroPhase,
} from "../../lib/pomodoro";
import { rankFocusTasks } from "../../lib/taskFocus";
import { readCachedRecommendation } from "../../lib/todayRecommendations";
import { localDateKey } from "../../lib/todayPlan";
import { formatEstimate } from "../../lib/taskEstimate";
import { useIsPhone } from "../../lib/useMediaQuery";
import { Icon } from "../Icon";
import { dueLabel } from "../TaskRow";
import { FocusDial } from "./FocusDial";
import { FocusSettingsDialog } from "./FocusSettingsDialog";
import { FocusTaskOption, FocusTaskPicker } from "./FocusTaskPicker";
import "./FocusView.css";

type Props = {
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[];
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
};

const PHASES: readonly PomodoroPhase[] = ["focus", "break", "long"];

export function PlayGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z" fill="currentColor" /></svg>;
}

export function PauseGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>;
}

function SkipGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 6.5v11l8-5.5-8-5.5Z" /><path d="M18 6v12" /></svg>;
}

function ZenGlyph({ active }: { readonly active: boolean }) {
  return active
    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
}

/** Live clock while the timer runs; still otherwise. */
function useTicking(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function toggleTimer(): void {
  const now = Date.now();
  const state = pomodoroStore.get();
  if (state.endsAt !== null) {
    pomodoroStore.set(pausePomodoro(state, now));
    return;
  }
  void requestNotificationPermission().catch(() => undefined);
  pomodoroStore.set(startPomodoro(state, now));
}

/** The Focus page: a Pomodoro timer around one chosen task, with today's focus stats. */
export function FocusView({ tasks, projects, onTaskChange, onTaskEdit }: Props) {
  const { t, tp, lang } = useI18n();
  const state = usePomodoro();
  const running = state.endsAt !== null;
  const now = useTicking(running);
  const isPhone = useIsPhone();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zen, setZen] = useState(false);
  const [completing, setCompleting] = useState(false);

  const todayKey = localDateKey(new Date(now));
  const ranked = useMemo(() => rankFocusTasks(tasks, todayKey), [tasks, todayKey]);
  const options = useMemo(() => {
    const aiPicks = readCachedRecommendation()?.value.focus.map((item) => item.taskId) ?? [];
    return pomodoroTaskOptions(tasks, [...aiPicks, ...ranked.slice(0, 3).map((task) => task.id)], ranked);
  }, [tasks, ranked]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const selected = state.taskId ? tasks.find((task) => task.id === state.taskId && !task.deletedAt) : undefined;
  const selectedProject = selected?.projectId ? projectById.get(selected.projectId) : undefined;
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const left = remainingMs(state, now);
  const progress = phaseProgress(state, now);
  const today = useMemo(() => new Date(now), [todayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => focusStatsFor(state.log, today), [state.log, today]);
  const history = useMemo(() => focusHistory(state.log, today), [state.log, today]);
  const maxHistory = Math.max(...history.map((day) => day.minutes), 1);
  const spentOnTask = selected ? state.log.filter((entry) => entry.taskId === selected.id) : [];
  const weekday = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: "narrow" }), [lang]);
  const clock = useMemo(() => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }), [lang]);
  const endsAt = state.endsAt !== null ? clock.format(new Date(state.endsAt)) : null;
  const phaseLabel = t(`focus.phase.${state.phase}`);
  const checklist = selected?.checklist ?? [];
  const checklistDone = checklist.filter((item) => item.done).length;

  const select = (taskId: string | null) => pomodoroStore.update((current) => ({ ...current, taskId }));
  const reset = () => pomodoroStore.update(resetPomodoro);
  const skip = () => pomodoroStore.update(skipPhase);
  const switchPhase = (phase: PomodoroPhase) => { if (phase !== state.phase) pomodoroStore.update((current) => choosePhase(current, phase)); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || pickerOpen || settingsOpen) return;
      if (document.querySelector(".prior-modal-backdrop")) return;
      const key = event.key.toLowerCase();
      // A focused button already answers Space with a click.
      if (key === " " && event.target instanceof HTMLElement && event.target.closest("button, a, [role='button'], [role='radio'], [role='switch']")) return;
      if (key === " ") { event.preventDefault(); toggleTimer(); }
      else if (key === "r") reset();
      else if (key === "s") skip();
      else if (key === "f") setZen((value) => !value);
      else if (key === "escape" && zen) setZen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function completeTask() {
    if (!selected || completing) return;
    setCompleting(true);
    try {
      await onTaskChange({ ...selected, completed: true, status: "done" });
      select(null);
    } finally {
      setCompleting(false);
    }
  }

  const suggestions = [...options.recommended, ...options.others].slice(0, isPhone ? 3 : 4);

  return (
    <div className={`focus-page is-${state.phase} ${running ? "is-running" : ""} ${zen ? "is-zen" : ""}`}>
      <header className="focus-header">
        <div className="focus-heading">
          <h1>{t("focus.title")}</h1>
          <span className="focus-subtitle">{t("focus.subtitle")}</span>
        </div>
        <div className="focus-header-actions">
          <button type="button" className="focus-icon-button" aria-label={t("focus.settings.title")} title={t("focus.settings.title")} onClick={() => setSettingsOpen(true)}><Icon name="sliders" /></button>
          <button type="button" className="focus-icon-button" aria-pressed={zen} aria-label={zen ? t("focus.zen.exit") : t("focus.zen.enter")} title={`${zen ? t("focus.zen.exit") : t("focus.zen.enter")} (F)`} onClick={() => setZen((value) => !value)}><ZenGlyph active={zen} /></button>
        </div>
      </header>

      <div className="focus-layout">
        <section className="focus-stage" aria-label={t("focus.timer")}>
          <div className="focus-phases" role="radiogroup" aria-label={t("focus.phaseLabel")}>
            {PHASES.map((phase) => (
              <button key={phase} type="button" role="radio" aria-checked={state.phase === phase} className={state.phase === phase ? "is-active" : ""} onClick={() => switchPhase(phase)}>
                {t(`focus.phase.${phase}`)}
              </button>
            ))}
          </div>

          <FocusDial progress={progress} running={running}>
            <span className="focus-dial-phase">{phaseLabel}</span>
            <time className="focus-dial-time" role="timer" aria-live="off" aria-label={t("focus.remaining", { time: formatCountdown(left) })}>{formatCountdown(left)}</time>
            <span className="focus-dial-meta">{endsAt ? t("focus.endsAt", { time: endsAt }) : progress > 0 ? t("focus.paused") : t("focus.ready")}</span>
          </FocusDial>

          <ol className="focus-cycle" aria-label={t("focus.cycle", { done: state.sessions, total: state.settings.longEvery })}>
            {Array.from({ length: state.settings.longEvery }, (_, index) => (
              <li key={index} className={index < state.sessions ? "is-done" : index === state.sessions && state.phase === "focus" ? "is-current" : ""} />
            ))}
          </ol>

          <div className="focus-controls">
            <button type="button" className="focus-control" aria-label={t("focus.reset")} title={`${t("focus.reset")} (R)`} onClick={reset}><Icon name="refresh" /></button>
            <button type="button" className="focus-play" aria-label={running ? t("focus.pause") : t("focus.start")} title={`${running ? t("focus.pause") : t("focus.start")} (${t("focus.spaceKey")})`} onClick={toggleTimer}>
              {running ? <PauseGlyph /> : <PlayGlyph />}
            </button>
            <button type="button" className="focus-control" aria-label={t("focus.skip")} title={`${t("focus.skip")} (S)`} onClick={skip}><SkipGlyph /></button>
          </div>
          {!isPhone && <p className="focus-shortcuts" aria-hidden="true"><kbd>{t("focus.spaceKey")}</kbd> {running ? t("focus.pause") : t("focus.start")} · <kbd>R</kbd> {t("focus.reset")} · <kbd>S</kbd> {t("focus.skip")} · <kbd>F</kbd> {t("focus.zen.short")}</p>}
          {zen && selected && <p className="focus-zen-task">{selected.title}</p>}
        </section>

        <aside className="focus-side">
          <section className="focus-card focus-task-card" aria-labelledby="focus-task-title">
            <div className="focus-card-head">
              <h2 id="focus-task-title">{selected ? t("focus.task.current") : t("focus.task.choose")}</h2>
              <button type="button" className="focus-link" onClick={() => setPickerOpen(true)}>{selected ? t("focus.task.change") : t("focus.task.browse")}</button>
            </div>
            {selected ? (
              <div className="focus-current">
                <button type="button" className="focus-current-title" onClick={() => onTaskEdit(selected)}>{selected.title}</button>
                <div className="focus-current-meta">
                  {selectedProject && <span className="focus-chip"><Icon name="folder" />{selectedProject.name}</span>}
                  {selected.priority < 4 && <span className={`focus-chip priority-${selected.priority}`}>P{selected.priority}</span>}
                  {(() => { const due = dueLabel(selected, lang, t); return due ? <span className={`focus-chip is-${due.tone}`}><Icon name="calendar-check" />{due.label}</span> : null; })()}
                  {formatEstimate(selected.estimatedMinutes) && <span className="focus-chip"><Icon name="hourglass" />{formatEstimate(selected.estimatedMinutes)}</span>}
                </div>
                {checklist.length > 0 && (
                  <div className="focus-checklist" aria-label={t("focus.task.checklist", { done: checklistDone, total: checklist.length })}>
                    <span className="focus-checklist-bar"><span style={{ width: `${(checklistDone / checklist.length) * 100}%` }} /></span>
                    <span>{checklistDone}/{checklist.length}</span>
                  </div>
                )}
                <p className="focus-current-spent">{spentOnTask.length ? tp("focus.task.spent", spentOnTask.length, { minutes: formatEstimate(spentOnTask.reduce((sum, entry) => sum + entry.minutes, 0)) ?? "" }) : t("focus.task.firstSession")}</p>
                <div className="focus-current-actions">
                  <button type="button" className="focus-done-button" disabled={completing} onClick={() => void completeTask()}><Icon name="check" />{t("focus.task.complete")}</button>
                  <button type="button" className="focus-secondary-button" onClick={() => onTaskEdit(selected)}><Icon name="pencil" />{t("focus.task.open")}</button>
                </div>
              </div>
            ) : suggestions.length > 0 ? (
              <ul className="focus-suggestions">
                {suggestions.map((task) => <li key={task.id}><FocusTaskOption task={task} project={task.projectId ? projectById.get(task.projectId) : undefined} onSelect={() => select(task.id)} /></li>)}
              </ul>
            ) : (
              <p className="focus-empty">{t("focus.task.empty")}</p>
            )}
          </section>

          <section className="focus-card focus-stats" aria-labelledby="focus-stats-title">
            <div className="focus-card-head"><h2 id="focus-stats-title">{t("focus.stats.title")}</h2></div>
            <div className="focus-stat-grid">
              <div><strong>{stats.sessions}</strong><span>{tp("focus.stats.sessions", stats.sessions)}</span></div>
              <div><strong>{formatEstimate(stats.minutes) ?? "0 min"}</strong><span>{t("focus.stats.minutes")}</span></div>
            </div>
            <div className="focus-week" role="img" aria-label={t("focus.stats.week")}>
              {history.map((day) => (
                <span key={day.date.toISOString()} className={`focus-week-day ${localDateKey(day.date) === todayKey ? "is-today" : ""}`} title={`${day.minutes} min`}>
                  <span className="focus-week-bar"><span style={{ height: `${Math.max(day.minutes ? 8 : 0, (day.minutes / maxHistory) * 100)}%` }} /></span>
                  <small>{weekday.format(day.date)}</small>
                </span>
              ))}
            </div>
            {stats.entries.length > 0 && (
              <ul className="focus-log">
                {stats.entries.slice(-4).reverse().map((entry) => (
                  <li key={entry.at}>
                    <time>{clock.format(new Date(entry.at))}</time>
                    <span>{(entry.taskId && taskById.get(entry.taskId)?.title) || t("focus.stats.freeSession")}</span>
                    <small>{entry.minutes} min</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {pickerOpen && <FocusTaskPicker recommended={options.recommended} others={options.others} projects={projects} selectedId={selected?.id ?? null} onSelect={select} onClose={() => setPickerOpen(false)} />}
      {settingsOpen && <FocusSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
