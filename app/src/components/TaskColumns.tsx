import type { Project, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { groupTasksByStatus } from "../lib/taskGroups";
import { Icon } from "./Icon";
import type { TaskComposerContext } from "./TaskComposer";
import { StatusGlyph } from "./TaskGlyphs";
import { TaskRow } from "./TaskRow";
import "./TaskList.css";

type Props = {
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly projects?: readonly Project[];
  /** Kept for API compatibility; board cards never show a status badge (the column does). */
  readonly hideNextStatus?: boolean;
  readonly onNewTask?: (context?: TaskComposerContext) => void;
  /** Show the Done column (when the filters include completed tasks). */
  readonly showDone?: boolean;
};

/** Board layout of the filtered task list: one grey column per workflow status. */
export function TaskColumns({ tasks, onChange, onDelete, onEdit, projects = [], onNewTask, showDone = false }: Props) {
  const { t } = useI18n();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  // Open statuses are always shown (an empty column still offers "+"); Done
  // only appears when the filters actually include completed work.
  const columns = groupTasksByStatus(showDone ? tasks : tasks.filter((task) => !task.completed)).filter((group) => group.status !== "done" || (showDone && group.tasks.length > 0));
  return (
    <section className="task-board" aria-label={t("tasks.list.boardLabel")}>
      {columns.map((column) => {
        const name = t(`tasks.list.groups.${column.status}`);
        const headingId = `task-board-${column.status}`;
        return (
          <section key={column.status} className={`task-board-column task-board-column-${column.status}`} aria-labelledby={headingId}>
            <header className="task-board-heading">
              <h2 id={headingId}><StatusGlyph status={column.status} />{name}<span className="task-group-count">{column.tasks.length}</span></h2>
              {onNewTask && column.status !== "done" && <button type="button" className="task-group-add" aria-label={t("tasks.list.addToGroup", { group: name })} title={t("tasks.list.addToGroup", { group: name })} onClick={() => onNewTask({ status: column.status })}><Icon name="plus" /></button>}
            </header>
            <div className="task-board-cards">
              {column.tasks.map((task) => (
                <div className="task-board-card" key={task.id}>
                  <TaskRow task={task} variant="card" project={task.projectId ? projectById.get(task.projectId) ?? null : null} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
                </div>
              ))}
              {!column.tasks.length && <p className="task-board-empty">{t("tasks.list.boardEmpty")}</p>}
            </div>
          </section>
        );
      })}
    </section>
  );
}
