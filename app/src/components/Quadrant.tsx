import type { Project, QuadrantKey, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";
import "./TaskList.css";

type Props = {
  readonly id: QuadrantKey;
  readonly label: string;
  /** Short axis description, e.g. "Important · Urgent". */
  readonly hint?: string;
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly projects?: readonly Project[];
  readonly hideNextStatus?: boolean;
  /** Creates a task preset for this quadrant (important/urgent flags). */
  readonly onAdd?: () => void;
};

export function Quadrant({ id, label, hint, tasks, onChange, onDelete, onEdit, onAdd }: Props) {
  const { t, tp } = useI18n();
  return (
    <section className={`quadrant quadrant-${id}`} aria-labelledby={`${id}-heading`}>
      <header className="quadrant-header">
        <span className="quadrant-dot" aria-hidden="true" />
        <div className="quadrant-heading">
          <h2 id={`${id}-heading`}>{label}</h2>
          {hint && <span className="quadrant-hint">{hint}</span>}
        </div>
        <span className="quadrant-count" aria-label={tp("tasks.matrix.count", tasks.length)}>{tasks.length}</span>
      </header>
      <div className="task-list">
        {tasks.map((task) => <TaskRow key={task.id} task={task} variant="compact" leading="check" showPriority={false} onChange={onChange} onDelete={onDelete} onEdit={onEdit} hideFlags />)}
      </div>
      {!tasks.length && <p className="quadrant-empty">{t("tasks.matrix.empty")}</p>}
      {onAdd && <button type="button" className="quadrant-add" aria-label={t("tasks.matrix.addTo", { quadrant: label })} onClick={onAdd}><Icon name="plus" />{t("tasks.matrix.add")}</button>}
    </section>
  );
}
