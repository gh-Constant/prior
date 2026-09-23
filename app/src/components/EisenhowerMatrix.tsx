import type { QuadrantKey, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { QUADRANTS } from "../lib/priority";
import { Icon } from "./Icon";
import { Quadrant } from "./Quadrant";
import type { TaskComposerContext } from "./TaskComposer";
import "./TaskList.css";

type Props = {
  readonly grouped: Readonly<Record<string, Task[]>>;
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly onNewTask?: (context?: TaskComposerContext) => void;
};

const QUADRANT_BY_KEY = new Map(QUADRANTS.map((quadrant) => [quadrant.key, quadrant]));

/** Eisenhower matrix with urgency across the top and importance down the side. */
export function EisenhowerMatrix({ grouped, onChange, onDelete, onEdit, onNewTask }: Props) {
  const { t } = useI18n();
  const quadrant = (key: QuadrantKey) => {
    const meta = QUADRANT_BY_KEY.get(key);
    return (
      <Quadrant
        key={key}
        id={key}
        label={t(`tasks.matrix.${key}`)}
        hint={t(`tasks.matrix.${key}Hint`)}
        tasks={grouped[key] ?? []}
        onChange={onChange}
        onDelete={onDelete}
        onEdit={onEdit}
        onAdd={onNewTask && meta ? () => onNewTask({ important: meta.important, urgent: meta.urgent }) : undefined}
      />
    );
  };
  return (
    <section className="eisenhower" aria-label={t("tasks.matrix.label")}>
      <div className="eisenhower-grid">
        <span className="eisenhower-axis eisenhower-corner" aria-hidden="true" />
        <div className="eisenhower-axis" aria-hidden="true"><Icon name="bolt" />{t("tasks.matrix.urgent")}</div>
        <div className="eisenhower-axis" aria-hidden="true"><Icon name="clock" />{t("tasks.matrix.notUrgent")}</div>
        <div className="eisenhower-axis eisenhower-axis-row" aria-hidden="true"><span>{t("tasks.matrix.important")}</span></div>
        {quadrant("focus")}
        {quadrant("plan")}
        <div className="eisenhower-axis eisenhower-axis-row" aria-hidden="true"><span>{t("tasks.matrix.notImportant")}</span></div>
        {quadrant("quick")}
        {quadrant("later")}
      </div>
    </section>
  );
}
