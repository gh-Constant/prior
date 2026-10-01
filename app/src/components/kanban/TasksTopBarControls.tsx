import { useI18n } from "../../lib/i18n";
import type { KanbanGroupBy } from "../../lib/kanban";
import { Icon } from "../Icon";
import { KanbanGroupByButton } from "./TasksKanban";

type Props = {
  readonly layout: "list" | "board";
  readonly onLayoutChange: (layout: "list" | "board") => void;
  readonly groupBy: KanbanGroupBy;
  readonly onGroupByChange: (groupBy: KanbanGroupBy) => void;
};

/** Phone top bar controls of the task views: List | Kanban toggle and, for the board, "Group by". */
export function TasksTopBarControls({ layout, onLayoutChange, groupBy, onGroupByChange }: Props) {
  const { t } = useI18n();
  return (
    <>
      {layout === "board" && <KanbanGroupByButton value={groupBy} onChange={onGroupByChange} />}
      <div className="mobile-segmented" role="group" aria-label={t("common.header.layout")}>
        <button type="button" aria-label={t("kanban.layout.list")} aria-pressed={layout === "list"} onClick={() => onLayoutChange("list")}><Icon name="list" /></button>
        <button type="button" aria-label={t("kanban.layout.board")} aria-pressed={layout === "board"} onClick={() => onLayoutChange("board")}><Icon name="columns" /></button>
      </div>
    </>
  );
}
