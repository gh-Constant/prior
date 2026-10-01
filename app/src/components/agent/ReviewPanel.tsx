import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentMessage } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { AreaCard, EntityUpdateCard, FolderCard, HabitCard, NoteCard, ProjectCard, TaskCreateCard, TaskUpdateCard } from "./ReviewCards";
import type { AssistantMessageHandlers } from "./handlers";
import { EMPTY_CONTEXT, summarizeProposals } from "./reviewModel";

/* Dismissals are remembered locally (like the "added" flags): the proposals stay stored with the chat. */
const DISMISSED_KEY = "prior.agent.dismissed.v1";
const MAX_DISMISSED = 500;

function loadDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(messageId: string, dismissed: boolean): void {
  try {
    const next = loadDismissed();
    if (dismissed) next.add(messageId);
    else next.delete(messageId);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-MAX_DISMISSED)));
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
}

type Flagged = { readonly selected: boolean; readonly added?: boolean };

function pending<T extends Flagged>(items: readonly T[] | undefined): T[] {
  return (items ?? []).filter((item) => item.selected && !item.added);
}

type PanelProps = {
  readonly message: AgentMessage;
  readonly handlers: AssistantMessageHandlers;
};

/**
 * One "Proposed changes" panel per assistant message: every new and changed item the assistant
 * suggests, with per-item checkboxes, one Apply bar, and a collapsed summary once it is all applied.
 * Nothing is saved before the user confirms; the confirm logic itself lives in the sidebar.
 */
export function ReviewPanel({ message, handlers }: PanelProps) {
  const { t, tp } = useI18n();
  const context = handlers.context ?? EMPTY_CONTEXT;
  const canUpdateTasks = Boolean(handlers.onUpdateTaskUpdate && handlers.onApplyTaskUpdate && handlers.onApplyAllTaskUpdates);
  const canUpdateEntities = Boolean(handlers.onUpdateEntityUpdate && handlers.onApplyEntityUpdate && handlers.onApplyAllEntityUpdates);
  const view = {
    proposedAreas: message.proposedAreas,
    proposedProjects: message.proposedProjects,
    proposedTasks: message.proposedTasks,
    proposedTaskUpdates: canUpdateTasks ? message.proposedTaskUpdates : undefined,
    proposedUpdates: canUpdateEntities ? message.proposedUpdates : undefined,
    proposedHabits: message.proposedHabits,
    proposedNotes: message.proposedNotes,
    proposedFolders: message.proposedFolders,
  };
  const summary = summarizeProposals(view);
  const complete = summary.total > 0 && summary.pending === 0;

  const [dismissed, setDismissed] = useState(() => loadDismissed().has(message.id));
  const [expanded, setExpanded] = useState(!complete);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const previousApplied = useRef(summary.applied);
  const wasComplete = useRef(complete);

  useEffect(() => () => { mounted.current = false; }, []);

  // Applied something: let the mascot celebrate.
  useEffect(() => {
    if (summary.applied > previousApplied.current) handlers.onApplied?.();
    previousApplied.current = summary.applied;
  }, [summary.applied, handlers]);

  // Everything applied: leave the success animation a moment, then fold the cards away.
  useEffect(() => {
    if (complete && !wasComplete.current) {
      const timer = window.setTimeout(() => setExpanded(false), 1500);
      wasComplete.current = true;
      return () => window.clearTimeout(timer);
    }
    wasComplete.current = complete;
    return undefined;
  }, [complete]);

  if (summary.total === 0) return null;

  const parts = [
    summary.areas ? tp("agentui.review.newAreas", summary.areas) : null,
    summary.projects ? tp("agentui.review.newProjects", summary.projects) : null,
    summary.folders ? tp("agentui.review.newFolders", summary.folders) : null,
    summary.tasks ? tp("agentui.review.newTasks", summary.tasks) : null,
    summary.habits ? tp("agentui.review.newHabits", summary.habits) : null,
    summary.notes ? tp("agentui.review.newNotes", summary.notes) : null,
    summary.changes ? tp("agentui.review.changes", summary.changes) : null,
  ].filter((part): part is string => part !== null);

  if (dismissed) {
    return (
      <div className="review-dismissed" role="status">
        <Icon name="close" />
        <span>{t("agentui.review.dismissed")}</span>
        <button type="button" onClick={() => { saveDismissed(message.id, false); setDismissed(false); }}>{t("agentui.review.showAgain")}</button>
      </div>
    );
  }

  async function applyAll(): Promise<void> {
    if (busy) return;
    const id = message.id;
    const steps: Array<() => void | Promise<void>> = [];
    // Areas and projects first: tasks and notes refer to them by name.
    const areas = pending(message.proposedAreas);
    if (areas.length && handlers.onAddAllAreas) steps.push(() => handlers.onAddAllAreas?.(id, areas));
    const projects = pending(message.proposedProjects);
    if (projects.length && handlers.onAddAllProjects) steps.push(() => handlers.onAddAllProjects?.(id, projects));
    const folders = pending(message.proposedFolders);
    if (folders.length) steps.push(() => handlers.onAddAllFolders(id, folders));
    const tasks = pending(message.proposedTasks);
    if (tasks.length) steps.push(() => handlers.onAddAllTasks(id, tasks));
    const habits = pending(message.proposedHabits);
    if (habits.length) steps.push(() => handlers.onAddAllHabits(id, habits));
    const notes = pending(message.proposedNotes);
    if (notes.length) steps.push(() => handlers.onAddAllNotes(id, notes));
    const taskUpdates = canUpdateTasks ? pending(message.proposedTaskUpdates) : [];
    if (taskUpdates.length) steps.push(() => handlers.onApplyAllTaskUpdates?.(id, taskUpdates));
    const entityUpdates = canUpdateEntities ? pending(message.proposedUpdates) : [];
    if (entityUpdates.length) steps.push(() => handlers.onApplyAllEntityUpdates?.(id, entityUpdates));
    setBusy(true);
    try {
      for (const step of steps) await step();
    } catch {
      // The sidebar already reported the failure; stop here so later steps never build on a missing one.
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const groups: Array<{ id: string; title: string; count: number; cards: ReactNode }> = [];
  const add = (id: string, titleKey: string, count: number, cards: ReactNode) => { if (count) groups.push({ id, title: t(titleKey), count, cards }); };
  add("areas", "agentui.review.groupAreas", message.proposedAreas?.length ?? 0, message.proposedAreas?.map((area) => <AreaCard key={area.id} messageId={message.id} area={area} handlers={handlers} />));
  add("projects", "agentui.review.groupProjects", message.proposedProjects?.length ?? 0, message.proposedProjects?.map((project) => <ProjectCard key={project.id} messageId={message.id} project={project} handlers={handlers} />));
  add("folders", "agentui.review.groupFolders", message.proposedFolders?.length ?? 0, message.proposedFolders?.map((folder) => <FolderCard key={folder.id} messageId={message.id} folder={folder} handlers={handlers} />));
  add("tasks", "agentui.review.groupTasks", message.proposedTasks?.length ?? 0, message.proposedTasks?.map((task) => <TaskCreateCard key={task.id} messageId={message.id} task={task} handlers={handlers} />));
  add("habits", "agentui.review.groupHabits", message.proposedHabits?.length ?? 0, message.proposedHabits?.map((habit) => <HabitCard key={habit.id} messageId={message.id} habit={habit} handlers={handlers} />));
  add("notes", "agentui.review.groupNotes", message.proposedNotes?.length ?? 0, message.proposedNotes?.map((note) => <NoteCard key={note.id} messageId={message.id} note={note} handlers={handlers} />));
  const changeCards = [
    ...(canUpdateTasks ? message.proposedTaskUpdates ?? [] : []).map((update) => <TaskUpdateCard key={update.id} messageId={message.id} update={update} handlers={handlers} context={context} />),
    ...(canUpdateEntities ? message.proposedUpdates ?? [] : []).map((update) => <EntityUpdateCard key={update.id} messageId={message.id} update={update} handlers={handlers} context={context} />),
  ];
  add("changes", "agentui.review.groupChanges", changeCards.length, changeCards);

  const applyLabel = busy
    ? t("agentui.review.applying")
    : summary.ready > 0 && summary.ready < summary.pending
      ? t("agentui.review.applyCount", { count: summary.ready })
      : t("agentui.review.applyAll");

  return (
    <section className={`review-panel${complete ? " is-complete" : ""}${expanded ? " is-expanded" : ""}`} aria-label={t("agentui.review.title")}>
      <header className="review-head">
        <span className="review-head-icon" aria-hidden="true"><Icon name={complete ? "check" : "sparkles"} /></span>
        <div className="review-head-copy">
          <strong>{complete ? t("agentui.review.allApplied") : t("agentui.review.title")}</strong>
          <span className="review-summary">{parts.join(" · ")}</span>
        </div>
        {complete && (
          <button type="button" className="review-toggle" aria-expanded={expanded} aria-label={expanded ? t("agentui.review.hideDetails") : t("agentui.review.showDetails")} title={expanded ? t("agentui.review.hideDetails") : t("agentui.review.showDetails")} onClick={() => setExpanded((value) => !value)}>
            <Icon name="chevron-down" />
          </button>
        )}
      </header>
      <div className="review-body">
        <div className="review-body-inner" inert={!expanded || undefined}>
          {groups.map((group) => (
            <div key={group.id} className="review-group">
              {groups.length > 1 && <h5 className="review-group-title">{group.title}<span>{group.count}</span></h5>}
              <div className="review-cards">{group.cards}</div>
            </div>
          ))}
        </div>
      </div>
      {!complete && (
        <footer className="review-bar">
          <span className="review-bar-note">{summary.applied > 0 ? t("agentui.review.progress", { applied: summary.applied, total: summary.total }) : t("agentui.review.selected", { count: summary.ready, total: summary.total })}</span>
          <button type="button" className="review-dismiss" disabled={busy} onClick={() => { saveDismissed(message.id, true); setDismissed(true); }}>{t("agentui.review.dismiss")}</button>
          <button type="button" className="primary-button review-apply-all" disabled={busy || summary.ready === 0} onClick={() => void applyAll()}>
            {busy ? <span className="review-spinner" aria-hidden="true" /> : <Icon name="check" />}
            <span>{applyLabel}</span>
          </button>
        </footer>
      )}
    </section>
  );
}
