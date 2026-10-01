// Small, static product mock-ups that illustrate each tour slide. They use
// the app's tokens so they follow the theme, and are hidden from assistive
// technology: the slide text carries the meaning.
import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { AgentIdentity } from "../AgentIdentity";
import { Icon } from "../Icon";

export type TourSlide = "today" | "capture" | "organize" | "eisenhower" | "focus" | "calendar" | "habits" | "notes" | "inbox" | "assistant" | "palette";

function Frame({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={`tour-art ${className}`} aria-hidden="true">{children}</div>;
}

function Check({ done = false }: { readonly done?: boolean }) {
  return <span className={`tour-check ${done ? "is-done" : ""}`}>{done && <Icon name="check" />}</span>;
}

function TodayArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-today">
      <div className="tour-panel">
        <span className="tour-panel-title">{t("tour.art.priorities")}</span>
        <span className="tour-row tour-animate-check"><Check done /><span>{t("tour.art.taskOne")}</span><i className="tour-dot is-red" /></span>
        <span className="tour-row"><Check /><span>{t("tour.art.taskTwo")}</span><i className="tour-dot is-amber" /></span>
        <span className="tour-row"><Check /><span>{t("tour.art.taskThree")}</span></span>
      </div>
      <div className="tour-panel tour-agenda">
        <span className="tour-panel-title">{t("tour.art.agenda")}</span>
        <span className="tour-event"><b>10:00</b>{t("tour.art.meeting")}</span>
        <span className="tour-free">{t("tour.art.freeTime")}</span>
        <span className="tour-event is-soft"><b>15:30</b>{t("tour.art.event")}</span>
      </div>
    </Frame>
  );
}

function CaptureArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-capture">
      <div className="tour-input"><Icon name="plus" /><span className="tour-typing">{t("tour.art.capture")}</span></div>
      <div className="tour-parsed">
        <strong>{t("tour.art.captureTitle")}</strong>
        <span className="tour-tokens">
          <span className="tour-token is-date"><Icon name="calendar-check" />{t("tour.art.tomorrow")}</span>
          <span className="tour-token is-p1">P1</span>
          <span className="tour-token is-project"><Icon name="folder" />{t("tour.art.project")}</span>
        </span>
      </div>
    </Frame>
  );
}

function OrganizeArt() {
  const { t } = useI18n();
  const column = (title: string, cards: number, tone: string) => (
    <div className="tour-column">
      <span className="tour-column-title"><i className={`tour-dot ${tone}`} />{title}</span>
      {Array.from({ length: cards }, (_, index) => <span key={index} className="tour-kcard"><i /><i /></span>)}
    </div>
  );
  return (
    <Frame className="tour-art-board">
      {column(t("tour.art.todo"), 3, "is-muted")}
      {column(t("tour.art.doing"), 2, "is-amber")}
      {column(t("tour.art.done"), 1, "is-green")}
    </Frame>
  );
}

function MatrixArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-matrix">
      {([["doNow", "is-red", 3], ["schedule", "is-blue", 2], ["delegate", "is-amber", 2], ["drop", "is-muted", 1]] as const).map(([key, tone, count]) => (
        <div key={key} className={`tour-quadrant ${tone}`}>
          <span>{t(`tour.art.${key}`)}</span>
          {Array.from({ length: count }, (_, index) => <i key={index} />)}
        </div>
      ))}
    </Frame>
  );
}

function FocusArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-focus">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" className="tour-ring-track" />
        <circle cx="60" cy="60" r="50" className="tour-ring-progress" transform="rotate(-90 60 60)" />
      </svg>
      <span className="tour-focus-center"><small>{t("tour.art.focusLabel")}</small><strong>18:42</strong></span>
    </Frame>
  );
}

function CalendarArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-calendar">
      {["09", "10", "11", "12", "13", "14"].map((hour) => <span key={hour} className="tour-hour">{hour}:00</span>)}
      <span className="tour-block is-event" style={{ top: "6%", height: "26%" }}>{t("tour.art.meeting")}</span>
      <span className="tour-block is-planned" style={{ top: "38%", height: "30%" }}>{t("tour.art.planned")}</span>
      <span className="tour-block is-event" style={{ top: "76%", height: "18%" }}>{t("tour.art.event")}</span>
    </Frame>
  );
}

function HabitsArt() {
  const { t } = useI18n();
  const row = (title: string, done: number, streak: number) => (
    <span className="tour-habit">
      <span>{title}</span>
      <span className="tour-habit-days">{Array.from({ length: 7 }, (_, index) => <i key={index} className={index < done ? "is-done" : ""} />)}</span>
      <b><Icon name="flame" />{streak}</b>
    </span>
  );
  return <Frame className="tour-art-habits">{row(t("tour.art.habitOne"), 6, 12)}{row(t("tour.art.habitTwo"), 4, 4)}</Frame>;
}

function NotesArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-notes">
      <strong>{t("tour.art.noteTitle")}</strong>
      <i className="tour-line" /><i className="tour-line is-short" />
      <span className="tour-note-heading">{t("tour.art.noteLine")}</span>
      <span className="tour-row"><Check done /><i className="tour-line" /></span>
      <span className="tour-row"><Check /><i className="tour-line is-short" /></span>
      <span className="tour-slash">/</span>
    </Frame>
  );
}

function InboxArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-inbox">
      <span className="tour-mail is-active">
        <span className="tour-avatar">C</span>
        <span className="tour-mail-text"><b>{t("tour.art.mailFrom")}</b><span>{t("tour.art.mailSubject")}</span></span>
        <span className="tour-mail-action"><Icon name="plus" />{t("tour.art.toTask")}</span>
      </span>
      <span className="tour-mail"><span className="tour-avatar is-blue">M</span><span className="tour-mail-text"><i className="tour-line is-short" /><i className="tour-line" /></span></span>
      <span className="tour-mail"><span className="tour-avatar is-green">L</span><span className="tour-mail-text"><i className="tour-line is-short" /><i className="tour-line" /></span></span>
    </Frame>
  );
}

function AssistantArt() {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-assistant">
      <span className="tour-bubble is-user">{t("tour.art.ask")}</span>
      <span className="tour-assistant-row">
        <AgentIdentity size="small" mood="happy" />
        <span className="tour-bubble">{t("tour.art.reply")}</span>
      </span>
      <span className="tour-review"><Icon name="plus" /><i className="tour-line" /><span className="tour-confirm">{t("tour.art.confirm")}</span></span>
    </Frame>
  );
}

function PaletteArt({ shortcut }: { readonly shortcut: string }) {
  const { t } = useI18n();
  return (
    <Frame className="tour-art-palette">
      <span className="tour-search"><Icon name="search" /><span>{t("tour.art.search")}</span><kbd>{shortcut}</kbd></span>
      <span className="tour-result is-active"><Icon name="calendar-check" />{t("tour.art.resultOne")}</span>
      <span className="tour-result"><Icon name="plus" />{t("tour.art.resultTwo")}</span>
      <span className="tour-result"><Icon name="moon" />{t("tour.art.resultThree")}</span>
    </Frame>
  );
}

export function TourArt({ slide, paletteShortcut }: { readonly slide: TourSlide; readonly paletteShortcut: string }) {
  switch (slide) {
    case "today": return <TodayArt />;
    case "capture": return <CaptureArt />;
    case "organize": return <OrganizeArt />;
    case "eisenhower": return <MatrixArt />;
    case "focus": return <FocusArt />;
    case "calendar": return <CalendarArt />;
    case "habits": return <HabitsArt />;
    case "notes": return <NotesArt />;
    case "inbox": return <InboxArt />;
    case "assistant": return <AssistantArt />;
    case "palette": return <PaletteArt shortcut={paletteShortcut} />;
  }
}
