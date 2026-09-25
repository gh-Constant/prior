import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { filterTasks, type TaskFilterState } from "../lib/taskFilters";
import { groupTasksByStatus, taskGroupStatus } from "../lib/taskGroups";
import { Icon } from "./Icon";
import { StatusGlyph } from "./TaskGlyphs";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskRow } from "./TaskRow";
import type { TaskComposerContext } from "./TaskComposer";
import "./TaskList.css";

type Props = {
  /** Every task (used for the done group and to keep the inspector in sync). */
  readonly tasks: readonly Task[];
  /** Tasks matching the current filters, already in the chosen sort order. */
  readonly visibleTasks: readonly Task[];
  readonly filters: TaskFilterState;
  readonly projects: readonly Project[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly onNewTask: (context?: TaskComposerContext) => void;
};

/** Container width from which the inspector sits beside the list (≈ a 1280px window). */
const PANEL_MIN_WIDTH = 940;
const MOBILE_QUERY = "(max-width: 760px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

/** True when the view is wide enough for a side inspector. Falls back to the window width. */
function useWideLayout(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1280);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      const update = () => setWide(window.innerWidth >= 1280);
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      setWide(width >= PANEL_MIN_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

export function AllTasksView({ tasks, visibleTasks, filters, projects, onChange, onDelete, onEdit, onNewTask }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const wide = useWideLayout(rootRef);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(filters.status === "completed");
  const [mobileStatus, setMobileStatus] = useState<TaskStatus | "all">("all");
  const lastGroup = useRef(new Map<string, TaskStatus>());
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  useEffect(() => { if (filters.status === "completed") setDoneOpen(true); }, [filters.status]);

  // With the default "open" filter, completed tasks live in the collapsed
  // "Done" row. A task that was just completed is still in visibleTasks while
  // its exit animation plays: keep it in the group it came from.
  const visibleIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const groups = useMemo(() => {
    const placement = (task: Task): TaskStatus | undefined => {
      if (task.completed && filters.status === "open") return lastGroup.current.get(task.id) ?? "done";
      return undefined;
    };
    const result = groupTasksByStatus(visibleTasks, placement);
    if (filters.status === "open") {
      const done = result.find((group) => group.status === "done");
      if (done) done.tasks.push(...filterTasks([...tasks], { ...filters, status: "completed" }).filter((task) => !visibleIds.has(task.id)));
    }
    return result;
  }, [filters, tasks, visibleIds, visibleTasks]);

  useEffect(() => {
    for (const task of visibleTasks) if (!task.completed) lastGroup.current.set(task.id, taskGroupStatus(task));
  }, [visibleTasks]);

  const selectedTask = selectedId ? tasks.find((task) => task.id === selectedId) ?? null : null;
  const showPanel = wide && !mobile && selectedTask !== null;

  useEffect(() => {
    if (selectedId && !tasks.some((task) => task.id === selectedId)) setSelectedId(null);
  }, [selectedId, tasks]);

  function openTask(task: Task): void {
    if (wide && !mobile) setSelectedId((current) => current === task.id ? null : task.id);
    else onEdit(task);
  }

  const openGroups = groups.filter((group) => group.status !== "done" && group.tasks.length > 0);
  const doneGroup = groups.find((group) => group.status === "done");
  const activeCount = openGroups.reduce((sum, group) => sum + group.tasks.length, 0);
  const filteredGroups = mobile && mobileStatus !== "all" ? openGroups.filter((group) => group.status === mobileStatus) : openGroups;
  const showDone = Boolean(doneGroup?.tasks.length) && (!mobile || mobileStatus === "all" || mobileStatus === "done");

  function row(task: Task) {
    return <TaskRow
      key={task.id}
      task={task}
      variant="compact"
      project={task.projectId ? projectById.get(task.projectId) ?? null : null}
      selected={showPanel && task.id === selectedId}
      onOpen={openTask}
      onChange={onChange}
      onDelete={onDelete}
      onEdit={onEdit}
    />;
  }

  const hasContent = openGroups.length > 0 || Boolean(doneGroup?.tasks.length);

  return (
    <div className="all-tasks-view" ref={rootRef}>
      {hasContent && mobile && <div className="task-status-chips" role="toolbar" aria-label={t("tasks.list.statusFilter")}>
        <button type="button" aria-pressed={mobileStatus === "all"} onClick={() => setMobileStatus("all")}>{t("tasks.list.chips.all")}<span>{activeCount}</span></button>
        {openGroups.map((group) => <button key={group.status} type="button" aria-pressed={mobileStatus === group.status} onClick={() => setMobileStatus(group.status)}>{t(`tasks.list.chips.${group.status}`)}<span>{group.tasks.length}</span></button>)}
        {Boolean(doneGroup?.tasks.length) && <button type="button" aria-pressed={mobileStatus === "done"} onClick={() => { setMobileStatus("done"); setDoneOpen(true); }}>{t("tasks.list.chips.done")}<span>{doneGroup?.tasks.length}</span></button>}
      </div>}
      {hasContent && <div className={`all-tasks-layout ${showPanel ? "has-panel" : ""}`}>
        <section className="task-group-list" aria-label={t("tasks.list.label")}>
          {filteredGroups.map((group) => {
            const name = t(`tasks.list.groups.${group.status}`);
            const headingId = `task-group-${group.status}`;
            return (
              <section key={group.status} className={`task-group task-group-${group.status}`} aria-labelledby={headingId}>
                <header className="task-group-header">
                  <h2 id={headingId}><StatusGlyph status={group.status} />{name}<span className="task-group-count">{group.tasks.length}</span></h2>
                  <button type="button" className="task-group-add" aria-label={t("tasks.list.addToGroup", { group: name })} title={t("tasks.list.addToGroup", { group: name })} onClick={() => onNewTask({ status: group.status })}><Icon name="plus" /></button>
                </header>
                <div className="task-group-rows">{group.tasks.map(row)}</div>
              </section>
            );
          })}
          {showDone && doneGroup && (
            <section className="task-group task-done-group" aria-label={t("tasks.list.groups.done")}>
              <button type="button" className="task-done-toggle" aria-expanded={doneOpen} aria-controls="task-group-done-rows" onClick={() => setDoneOpen((open) => !open)}>
                <StatusGlyph status="done" />
                <span>{t("tasks.list.doneToggle", { count: doneGroup.tasks.length })}</span>
                <Icon name="chevron-right" aria-hidden="true" />
              </button>
              {doneOpen && <div className="task-group-rows" id="task-group-done-rows">{doneGroup.tasks.map(row)}</div>}
            </section>
          )}
        </section>
        {showPanel && selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            project={selectedTask.projectId ? projectById.get(selectedTask.projectId) ?? null : null}
            onChange={onChange}
            onEdit={onEdit}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>}
    </div>
  );
}
