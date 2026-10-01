import { useMemo, useState } from "react";
import type { Project, Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { KANBAN_GROUP_BYS, applyKanbanMove, buildKanbanColumns, dateKey, dueDropDate, isTaskBlocked, type DueBucket, type KanbanColumnData, type KanbanGlyph, type KanbanGroupBy } from "../../lib/kanban";
import { filterTasks, type TaskFilterState } from "../../lib/taskFilters";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import type { TaskComposerContext } from "../TaskComposer";
import { CalendarGlyph, PriorityGlyph, StatusGlyph } from "../TaskGlyphs";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "../WorkspaceIcon";
import { KanbanBoard, type KanbanColumn } from "./KanbanBoard";
import { KanbanTaskCard } from "./TaskCard";
import "./Kanban.css";

/** Finished work stays visible but does not take over the board. */
const DONE_PREVIEW_COUNT = 3;

function ColumnGlyph({ glyph, label }: { readonly glyph: KanbanGlyph; readonly label: string }) {
  if (glyph.kind === "status") return <StatusGlyph status={glyph.status} />;
  if (glyph.kind === "priority") return <PriorityGlyph priority={glyph.priority} label={label} />;
  if (glyph.kind === "project") return <span className="kanban-glyph-project"><WorkspaceIcon icon={glyph.project?.icon} fallback={glyph.project?.projectType === "software" ? "code" : DEFAULT_PROJECT_ICON} /></span>;
  return <span className={`kanban-glyph-due is-${glyph.bucket}`}><CalendarGlyph /></span>;
}

type GroupByProps = {
  readonly value: KanbanGroupBy;
  readonly onChange: (value: KanbanGroupBy) => void;
};

/** Segmented "Group by" control shown above the board on desktop. */
export function KanbanGroupBy({ value, onChange }: GroupByProps) {
  const { t } = useI18n();
  return (
    <div className="kanban-groupby" role="group" aria-label={t("kanban.groupBy")}>
      <span className="kanban-groupby-label" aria-hidden="true">{t("kanban.groupBy")}</span>
      <div className="kanban-groupby-options">
        {KANBAN_GROUP_BYS.map((option) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{t(`kanban.group.${option}`)}</button>)}
      </div>
    </div>
  );
}

const GROUP_ICONS: Record<KanbanGroupBy, "list-todo" | "flag" | "folder" | "calendar-check"> = { status: "list-todo", priority: "flag", project: "folder", due: "calendar-check" };

/** Phone "Group by" button: opens the grouping choices as an action sheet. */
export function KanbanGroupByButton({ value, onChange }: GroupByProps) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const items: ContextMenuItem[] = KANBAN_GROUP_BYS.map((option) => ({
    icon: value === option ? "check" : GROUP_ICONS[option],
    label: t(`kanban.group.${option}`),
    run: () => onChange(option),
  }));
  return (
    <>
      <button
        type="button"
        className="mobile-icon-button kanban-groupby-button"
        aria-label={t("kanban.groupByCurrent", { group: t(`kanban.group.${value}`) })}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ x: rect.right - 220, y: rect.bottom + 6 }); }}
      >
        <Icon name="layers" />
      </button>
      {anchor && <ContextMenu x={anchor.x} y={anchor.y} items={items} onClose={() => setAnchor(null)} />}
    </>
  );
}

type Props = {
  /** Every task (blockers, and the completed ones hidden by the list filter). */
  readonly tasks: readonly Task[];
  /** Tasks matching the current filters, already sorted. */
  readonly visibleTasks: readonly Task[];
  readonly filters: TaskFilterState;
  readonly projects: readonly Project[];
  readonly groupBy: KanbanGroupBy;
  readonly onGroupByChange: (groupBy: KanbanGroupBy) => void;
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly onNewTask?: (context?: TaskComposerContext) => void;
};

/** The "All tasks" / "My tasks" Kanban: columns by status, priority, project or due date. */
export function TasksKanban({ tasks, visibleTasks, filters, projects, groupBy, onGroupByChange, onChange, onDelete, onEdit, onNewTask }: Props) {
  const { t } = useI18n();
  const today = dateKey(new Date());
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const context = useMemo(() => ({
    projects,
    today,
    // The default list filter hides completed work: the Done column still shows the latest.
    doneTasks: groupBy === "status" && filters.status === "open" ? filterTasks([...tasks], { ...filters, status: "completed" }) : undefined,
  }), [filters, groupBy, projects, tasks, today]);
  const data = useMemo(() => buildKanbanColumns(visibleTasks, groupBy, context), [context, groupBy, visibleTasks]);

  const columns: KanbanColumn<Task>[] = data.map((column: KanbanColumnData) => {
    const label = column.labelKey ? t(column.labelKey) : column.label ?? "";
    const done = groupBy === "status" && column.id === "done";
    return {
      id: column.id,
      label,
      glyph: <ColumnGlyph glyph={column.glyph} label={label} />,
      items: done ? [...column.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : column.tasks,
      canAdd: column.canAdd && Boolean(onNewTask),
      canDrop: column.droppable,
      previewCount: done ? DONE_PREVIEW_COUNT : undefined,
    };
  });

  async function move(taskId: string, columnId: string): Promise<void> {
    const task = byId.get(taskId);
    const next = task ? applyKanbanMove(task, groupBy, columnId, context) : null;
    // changeTask throws for read-only shared projects: the board shows the message.
    if (next) await onChange(next);
  }

  function add(columnId: string): void {
    if (!onNewTask) return;
    if (groupBy === "status") onNewTask({ status: columnId as TaskComposerContext["status"] });
    else if (groupBy === "priority") onNewTask({ priority: Number(columnId) as 1 | 2 | 3 | 4 });
    else if (groupBy === "project") {
      const project = projectById.get(columnId);
      onNewTask(project ? { projectId: project.id, areaId: project.areaId } : undefined);
    } else {
      const dueDate = dueDropDate(columnId as DueBucket, today);
      onNewTask(dueDate ? { dueDate } : undefined);
    }
  }

  const menuItems = (task: Task): ContextMenuItem[] => [
    { icon: "pencil", label: t("tasks.row.edit"), run: () => onEdit(task) },
    { icon: "check-circle", label: task.completed ? t("tasks.row.markIncomplete") : t("tasks.row.markComplete"), run: () => { void onChange({ ...task, completed: !task.completed }); } },
    { icon: "trash", label: t("tasks.row.delete"), danger: true, run: () => { void onDelete(task); } },
  ];

  return (
    <section className="tasks-kanban" aria-label={t("tasks.list.boardLabel")}>
      <KanbanGroupBy value={groupBy} onChange={onGroupByChange} />
      <KanbanBoard
        columns={columns}
        label={t("kanban.boardBy", { group: t(`kanban.group.${groupBy}`) })}
        emptyLabel={t("tasks.list.boardEmpty")}
        onMove={move}
        onAdd={onNewTask ? add : undefined}
        menuItems={menuItems}
        itemClassName={(task) => task.completed ? "is-done" : ""}
        renderCard={(task) => <KanbanTaskCard
          task={task}
          today={today}
          project={groupBy !== "project" && task.projectId ? projectById.get(task.projectId) ?? null : null}
          blocked={isTaskBlocked(task, byId)}
          onOpen={onEdit}
          onChange={onChange}
        />}
      />
    </section>
  );
}
