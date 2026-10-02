import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { CollaborationState } from "./CollaborationState";
import { PersonAvatar } from "./PersonAvatar";
import type { Person, ProjectActivityEntry } from "./types";
import "./ProjectActivity.css";

type Metric = "completed" | "created";

const WEEKS = 53;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Columns of 7 days (a week each) ending with the current week. */
export function activityWeeks(today: Date, mondayFirst: boolean): Date[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekday = mondayFirst ? (end.getDay() + 6) % 7 : end.getDay();
  const start = new Date(end);
  start.setDate(end.getDate() - weekday - (WEEKS - 1) * 7);
  const weeks: Date[][] = [];
  for (let week = 0; week < WEEKS; week += 1) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  return weeks;
}

/** 0 (nothing) to 4 (the busiest days), relative to the busiest day. */
export function activityLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** Days in a row, ending today or yesterday, with at least one item. */
export function currentStreak(counts: ReadonlyMap<string, number>, today: Date): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!counts.get(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (counts.get(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

type Props = {
  readonly loadActivity?: () => Promise<ProjectActivityEntry[]>;
  readonly people: readonly Person[];
  readonly currentUserId?: string | null;
};

/**
 * GitHub-style contribution grid for a project: one square per day, darker
 * when more tasks were completed (or created), with per-person totals.
 */
export function ProjectActivity({ loadActivity, people, currentUserId }: Props) {
  const { t, tp, lang } = useI18n();
  const [entries, setEntries] = useState<ProjectActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [metric, setMetric] = useState<Metric>("completed");
  const [personId, setPersonId] = useState<string | null>(null);
  const [today] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!loadActivity) {
      setEntries([]);
      return undefined;
    }
    setFailed(false);
    loadActivity()
      .then((next) => { if (!cancelled) setEntries(next); })
      .catch(() => { if (!cancelled) { setFailed(true); setEntries([]); } });
    return () => { cancelled = true; };
  }, [loadActivity]);

  const mondayFirst = lang !== "en";
  const weeks = useMemo(() => activityWeeks(today, mondayFirst), [today, mondayFirst]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries ?? []) {
      if (personId && entry.userId !== personId) continue;
      map.set(entry.date, (map.get(entry.date) ?? 0) + entry[metric]);
    }
    return map;
  }, [entries, metric, personId]);
  const firstDay = dayKey(weeks[0][0]);
  const lastDay = dayKey(today);
  const inRange = [...counts.entries()].filter(([date]) => date >= firstDay && date <= lastDay);
  const total = inRange.reduce((sum, [, count]) => sum + count, 0);
  const max = inRange.reduce((best, [, count]) => Math.max(best, count), 0);
  const bestDay = inRange.find(([, count]) => count === max && max > 0)?.[0];
  const streak = currentStreak(counts, today);
  const contributors = useMemo(() => {
    const byPerson = new Map<string, { completed: number; created: number }>();
    for (const entry of entries ?? []) {
      if (entry.date < firstDay) continue;
      const key = entry.userId ?? "";
      const current = byPerson.get(key) ?? { completed: 0, created: 0 };
      current.completed += entry.completed;
      current.created += entry.created;
      byPerson.set(key, current);
    }
    return [...byPerson.entries()]
      .map(([id, totals]) => ({ id, person: people.find((candidate) => candidate.id === id), ...totals }))
      .filter((row) => row[metric] > 0)
      .sort((left, right) => right[metric] - left[metric]);
  }, [entries, people, metric, firstDay]);
  const topCount = contributors[0]?.[metric] ?? 0;
  // A month label sits over the first week that ends in that month, and the
  // first column only gets one when the next label is far enough away.
  const monthStarts = useMemo(() => {
    const starts = new Set<number>();
    weeks.forEach((week, index) => {
      if (index > 0 && week[6].getMonth() !== weeks[index - 1][6].getMonth()) starts.add(index);
    });
    const next = [...starts][0] ?? WEEKS;
    if (next >= 3) starts.add(0);
    return starts;
  }, [weeks]);
  const monthFormat = new Intl.DateTimeFormat(lang, { month: "short" });
  const dayFormat = new Intl.DateTimeFormat(lang, { weekday: "short" });
  const fullFormat = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const metricLabel = (count: number) => tp(metric === "completed" ? "collab.activity.completedCount" : "collab.activity.createdCount", count);

  // Like GitHub: the grid opens on the current week (its right end).
  const loaded = entries !== null;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (loaded && scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [loaded]);

  if (entries === null) return <CollaborationState title={t("collab.activity.loading")} loading />;

  return <div className="project-activity">
    <div className="project-activity-toolbar">
      <div className="collab-assignee-filter" role="group" aria-label={t("collab.activity.metric")}>
        <button type="button" className={`collab-chip-btn ${metric === "completed" ? "selected" : ""}`} aria-pressed={metric === "completed"} onClick={() => setMetric("completed")}><Icon name="check-circle" />{t("collab.activity.completed")}</button>
        <button type="button" className={`collab-chip-btn ${metric === "created" ? "selected" : ""}`} aria-pressed={metric === "created"} onClick={() => setMetric("created")}><Icon name="plus" />{t("collab.activity.created")}</button>
      </div>
      {personId && <button type="button" className="collab-chip-btn selected" onClick={() => setPersonId(null)}><Icon name="close" />{people.find((person) => person.id === personId)?.name ?? t("collab.activity.someone")}</button>}
    </div>
    {failed && <p className="collab-notice" role="status"><Icon name="cloud" aria-hidden="true" />{t("collab.activity.offline")}</p>}
    <div className="project-activity-stats">
      <div><strong>{total}</strong><span>{t(metric === "completed" ? "collab.activity.totalCompleted" : "collab.activity.totalCreated")}</span></div>
      <div><strong>{streak}</strong><span>{tp("collab.activity.streakDays", streak)}</span></div>
      <div><strong>{max || "—"}</strong><span>{bestDay ? t("collab.activity.bestDayOn", { date: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(new Date(`${bestDay}T12:00:00`)) }) : t("collab.activity.bestDay")}</span></div>
    </div>
    <div className="project-activity-scroll" ref={scrollRef}>
      <div className="project-activity-grid" role="img" aria-label={t("collab.activity.gridLabel", { count: total })} style={{ gridTemplateColumns: `auto repeat(${WEEKS}, var(--activity-cell))` }}>
        <span />
        {weeks.map((week, index) => <span key={`m-${index}`} className="project-activity-month">{monthStarts.has(index) ? monthFormat.format(week[week.length - 1]) : ""}</span>)}
        {Array.from({ length: 7 }, (_, row) => [
          <span key={`d-${row}`} className="project-activity-weekday">{row % 2 === 1 ? dayFormat.format(weeks[0][row]) : ""}</span>,
          ...weeks.map((week, column) => {
            const date = week[row];
            const key = dayKey(date);
            const future = key > lastDay;
            const count = counts.get(key) ?? 0;
            return <span key={`${column}-${row}`} className={`project-activity-cell level-${future ? "none" : activityLevel(count, max)}`} title={future ? undefined : `${metricLabel(count)} · ${fullFormat.format(date)}`} />;
          }),
        ])}
      </div>
    </div>
    <div className="project-activity-legend" aria-hidden="true"><span>{t("collab.activity.less")}</span>{[0, 1, 2, 3, 4].map((level) => <span key={level} className={`project-activity-cell level-${level}`} />)}<span>{t("collab.activity.more")}</span></div>
    <section className="project-activity-people" aria-label={t("collab.activity.contributors")}>
      <h3>{t("collab.activity.contributors")}</h3>
      {contributors.length ? <ul>{contributors.map((row) => {
        const name = row.person?.name ?? (row.id ? t("collab.activity.formerMember") : t("comments.deletedUser"));
        const person: Person = row.person ?? { id: row.id || "unknown", name };
        const selected = personId === row.id;
        return <li key={row.id || "none"}>
          <button type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} disabled={!row.id} onClick={() => setPersonId(selected ? null : row.id)}>
            <PersonAvatar person={person} className="collab-avatar collab-avatar-sm" />
            <span className="project-activity-name">{name}{row.id === currentUserId ? ` ${t("collab.share.you")}` : ""}</span>
            <span className="project-activity-bar" aria-hidden="true"><span style={{ width: `${topCount ? Math.max(6, (row[metric] / topCount) * 100) : 0}%` }} /></span>
            <span className="project-activity-count">{metricLabel(row[metric])}</span>
          </button>
        </li>;
      })}</ul> : <p className="collab-muted">{t("collab.activity.empty")}</p>}
    </section>
  </div>;
}
