import { useMemo } from "react";
import type { Project, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { avatarTone, daysSince, groupWaitingTasks, initials, localDateKey, looksLikeEmail, waitingSince } from "../lib/todayPlan";
import { Icon } from "./Icon";
import "./WaitingView.css";

export type WaitingViewProps = {
  readonly tasks: Task[];
  readonly projects: Project[];
  readonly onAdd: () => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
};

/** Days after which a waiting item reads as stale (bar and label turn red). */
const STALE_AFTER_DAYS = 5;
/** Days that fill the age bar completely. */
const AGE_BAR_FULL_DAYS = 7;
const UPCOMING_LIMIT = 6;

function addDays(value: Date, amount: number): Date {
  const next = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

export function WaitingView({ tasks, projects, onAdd, onTaskChange, onTaskEdit }: WaitingViewProps) {
  const { t, tp, lang } = useI18n();
  const now = new Date();
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(addDays(now, 1));
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const groups = useMemo(() => groupWaitingTasks(tasks), [tasks]);
  const ages = tasks.map((task) => daysSince(waitingSince(task), now)).filter((value): value is number => value !== null);
  const averageWait = ages.length ? ages.reduce((total, value) => total + value, 0) / ages.length : null;
  const followUpsDue = tasks.filter((task) => task.followUpDate && task.followUpDate <= todayKey).length;
  const upcoming = tasks
    .filter((task) => Boolean(task.followUpDate))
    .sort((left, right) => `${left.followUpDate}${left.followUpTime ?? ""}`.localeCompare(`${right.followUpDate}${right.followUpTime ?? ""}`))
    .slice(0, UPCOMING_LIMIT);

  function shortDate(value: string, weekday = false): string {
    return new Date(`${value}T00:00:00`).toLocaleDateString(lang, weekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  }

  function sinceLabel(task: Task): { days: number; text: string } {
    const days = daysSince(waitingSince(task), now) ?? 0;
    return { days, text: days > 0 ? tp("tasks.waiting.since", days) : t("tasks.waiting.sinceToday") };
  }

  function followUpChip(task: Task): { text: string; tone: "due" | "overdue" | "planned" } | null {
    if (!task.followUpDate) return null;
    if (task.followUpDate < todayKey) return { text: t("tasks.waiting.followUpOverdue", { date: shortDate(task.followUpDate) }), tone: "overdue" };
    if (task.followUpDate === todayKey) return { text: t("tasks.waiting.followUpToday"), tone: "due" };
    return { text: t("tasks.waiting.followUpOn", { date: shortDate(task.followUpDate) }), tone: "planned" };
  }

  function upcomingDay(value: string): string {
    if (value < todayKey) return t("tasks.waiting.upcomingOverdue", { date: shortDate(value) });
    if (value === todayKey) return t("tasks.waiting.upcomingToday");
    if (value === tomorrowKey) return t("tasks.waiting.upcomingTomorrow");
    const label = shortDate(value, true);
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  }

  function upcomingTone(value: string): string {
    if (value <= todayKey) return "is-due";
    return value <= localDateKey(addDays(now, 3)) ? "is-soon" : "";
  }

  return (
    <section className="waiting-view" aria-label={t("tasks.waiting.title")}>
      <header className="waiting-header">
        <div className="waiting-heading">
          <h2>{t("tasks.waiting.title")}</h2>
          <span>{t("tasks.waiting.subtitle")}</span>
        </div>
        <button type="button" className="primary-button" onClick={onAdd}><Icon name="plus" /><span>{t("common.workhub.waitingAction")}</span></button>
      </header>

      {tasks.length === 0 ? (
        <div className="workhub-empty-state"><Icon name="check-circle" /><h3>{t("common.workhub.waitingEmpty")}</h3><p>{t("common.workhub.waitingDescription")}</p><button type="button" className="primary-button" onClick={onAdd}><Icon name="plus" />{t("common.workhub.waitingAction")}</button></div>
      ) : <>
        <div className="waiting-stats">
          <div className="waiting-stat">
            <span className="waiting-stat-icon" aria-hidden="true"><Icon name="later" /></span>
            <div><strong>{tasks.length}</strong><span>{tp("tasks.waiting.statWaiting", tasks.length)}</span></div>
          </div>
          <div className="waiting-stat">
            <span className={`waiting-stat-icon ${followUpsDue ? "is-accent" : ""}`} aria-hidden="true"><Icon name="bell" /></span>
            <div><strong>{followUpsDue}</strong><span>{tp("tasks.waiting.statFollowUps", followUpsDue)}</span></div>
          </div>
          {averageWait !== null && (
            <div className="waiting-stat">
              <span className="waiting-stat-icon" aria-hidden="true"><Icon name="trending-up" /></span>
              <div><strong>{t("tasks.waiting.averageDays", { value: averageWait.toLocaleString(lang, { maximumFractionDigits: 1 }) })}</strong><span>{t("tasks.waiting.statAverage")}</span></div>
            </div>
          )}
        </div>

        <div className={`waiting-grid ${upcoming.length ? "" : "is-single"}`}>
          <div className="waiting-groups">
            {groups.map((group) => {
              const name = group.name ?? t("tasks.waiting.unassigned");
              return (
                <section key={group.key || "unassigned"} className="waiting-group" aria-label={name}>
                  <div className="waiting-group-head">
                    <span className={`waiting-avatar tone-${group.name ? avatarTone(group.name) : "neutral"}`} aria-hidden="true">{group.name ? initials(group.name) : <Icon name="user" />}</span>
                    <div className="waiting-group-title">
                      <h3>{name}</h3>
                      <span>{tp("tasks.waiting.groupCount", group.tasks.length)}</span>
                    </div>
                    {group.name && looksLikeEmail(group.name) && <a className="secondary-button waiting-small-button" href={`mailto:${group.name.trim()}`} aria-label={t("tasks.waiting.writeAria", { name: group.name })}><Icon name="mail" />{t("tasks.waiting.write")}</a>}
                  </div>
                  <ul className="waiting-list">
                    {group.tasks.map((task) => {
                      const project = task.projectId ? projectById.get(task.projectId) : undefined;
                      const since = sinceLabel(task);
                      const chip = followUpChip(task);
                      const stale = since.days >= STALE_AFTER_DAYS;
                      return (
                        <li key={task.id} className="waiting-item">
                          <span className="waiting-status" aria-hidden="true" />
                          <div className="waiting-item-body">
                            <button type="button" className="waiting-item-title" onClick={() => onTaskEdit(task)}>{task.title}</button>
                            {(project || chip) && (
                              <div className="waiting-item-meta">
                                {project && <span className="waiting-chip"><Icon name="folder" className="is-project" aria-hidden="true" /><span>{project.name}</span></span>}
                                {chip && <span className={`waiting-chip is-${chip.tone}`}><Icon name="bell" aria-hidden="true" /><span>{chip.text}</span></span>}
                              </div>
                            )}
                          </div>
                          <div className={`waiting-age ${stale ? "is-stale" : ""}`}>
                            <span className="waiting-age-track" role="img" aria-label={t("tasks.waiting.ageLabel", { since: since.text })}>
                              <span style={{ width: `${Math.max(4, Math.min(100, (since.days / AGE_BAR_FULL_DAYS) * 100))}%` }} />
                            </span>
                            <span className="waiting-age-label">{since.text}</span>
                          </div>
                          <div className="waiting-actions">
                            <button type="button" className="secondary-button waiting-small-button" aria-label={t("tasks.waiting.remindAria", { title: task.title })} onClick={() => onTaskEdit(task)}><Icon name="send" />{t("tasks.waiting.remind")}</button>
                            <button type="button" className="secondary-button waiting-small-button" aria-label={t("tasks.waiting.receivedAria", { title: task.title })} onClick={() => void onTaskChange({ ...task, completed: true })}><Icon name="check" />{t("tasks.waiting.received")}</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {upcoming.length > 0 && (
            <section className="waiting-upcoming" aria-labelledby="waiting-upcoming-title">
              <div className="waiting-upcoming-head">
                <h3 id="waiting-upcoming-title">{t("tasks.waiting.upcomingTitle")}</h3>
                <span>{upcoming.length}</span>
              </div>
              <ol className="waiting-timeline">
                {upcoming.map((task) => (
                  <li key={task.id} className={`waiting-timeline-item ${upcomingTone(task.followUpDate ?? "")}`}>
                    <span className="waiting-timeline-rail" aria-hidden="true"><span /></span>
                    <div>
                      <span className="waiting-timeline-date">{upcomingDay(task.followUpDate ?? "")}{task.followUpTime ? ` · ${task.followUpTime}` : ""}</span>
                      <button type="button" className="waiting-timeline-title" onClick={() => onTaskEdit(task)}>{task.title}</button>
                      <span className="waiting-timeline-meta">{task.assigneeName?.trim() ? t("tasks.waiting.upcomingWith", { name: task.assigneeName.trim() }) : t("tasks.waiting.upcomingPlanned")}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </>}
    </section>
  );
}
