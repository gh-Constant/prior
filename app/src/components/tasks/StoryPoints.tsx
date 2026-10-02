import type { ReactNode } from "react";
import type { Project, Task } from "../../types";
import { taskBadgeKind } from "../../lib/agile";
import { useI18n } from "../../lib/i18n";
import { formatStoryPoints, formatStoryPointsValue, normalizeStoryPoints } from "../../lib/storyPoints";
import { CustomSelect } from "../CustomSelect";
import { Icon } from "../Icon";
import "./StoryPoints.css";

/** The cards of the picker: the usual Fibonacci-like scale of story points. */
export const STORY_POINT_DECK: readonly number[] = [0, 0.5, 1, 2, 3, 5, 8, 13, 21];

/** Which stylesheet family the chip borrows from: task rows, project/board cards or the collaboration chips. */
export type StoryPointsChipVariant = "row" | "project" | "collab";
const CHIP_CLASS: Record<StoryPointsChipVariant, string> = { row: "task-chip", project: "project-chip", collab: "collab-chip" };

/** "5 pts", "½ pt" or a dashed "–" for a task that is not estimated yet. */
export function StoryPointsChip({ points, variant = "row", className = "" }: { readonly points: number | null | undefined; readonly variant?: StoryPointsChipVariant; readonly className?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const value = normalizeStoryPoints(points);
  const base = `${CHIP_CLASS[variant]} story-points-chip ${className}`.trim();
  if (value === null) {
    const label = t("scrum.notEstimated");
    return <span className={`${base} is-empty`} role="img" aria-label={label} title={label}>–</span>;
  }
  const text = formatStoryPoints(value, i18n);
  return <span className={base} title={`${t("scrum.picker.label")}: ${text}`}>{text}</span>;
}

type SizeProject = Pick<Project, "projectType" | "methodology"> | null | undefined;

/**
 * The size of a task next to its title: story points in Scrum and Scrumban
 * projects, otherwise the given priority glyph (`children`) as before.
 */
export function TaskSizeBadge({ task, project, variant = "row", children = null }: {
  readonly task: Pick<Task, "storyPoints">;
  readonly project: SizeProject;
  readonly variant?: StoryPointsChipVariant;
  /** Rendered when the project does not use story points. */
  readonly children?: ReactNode;
}) {
  if (taskBadgeKind(project) !== "points") return <>{children}</>;
  return <StoryPointsChip points={task.storyPoints} variant={variant} />;
}

type PickerProps = {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  /** Smaller cards, for dense panels. */
  readonly compact?: boolean;
  readonly disabled?: boolean;
  /** Accessible name; defaults to "Story points". */
  readonly label?: string;
};

/** Deck of cards (0, ½, 1, 2, 3, 5, 8, 13, 21) plus Clear. A value outside the deck (4, 20…) gets its own selected card. */
export function StoryPointsPicker({ value, onChange, compact = false, disabled = false, label }: PickerProps) {
  const { t } = useI18n();
  const current = normalizeStoryPoints(value);
  const cards = current !== null && !STORY_POINT_DECK.includes(current) ? [...STORY_POINT_DECK, current].sort((a, b) => a - b) : STORY_POINT_DECK;
  return (
    <div className={`story-points-picker${compact ? " is-compact" : ""}`} role="group" aria-label={label ?? t("scrum.picker.label")}>
      <div className="story-points-cards">
        {cards.map((card) => {
          const text = formatStoryPointsValue(card);
          const selected = card === current;
          return (
            <button key={card} type="button" className={`story-points-card${selected ? " is-selected" : ""}`} aria-pressed={selected} aria-label={t("scrum.picker.option", { value: text })} disabled={disabled} onClick={() => { if (!selected) onChange(card); }}>{text}</button>
          );
        })}
      </div>
      <button type="button" className="story-points-clear" aria-label={t("scrum.picker.clearLabel")} disabled={disabled || current === null} onClick={() => onChange(null)}>{t("scrum.picker.clear")}</button>
    </div>
  );
}

/** Pill select of the task composer: the same deck as a dropdown. */
export function StoryPointsSelect({ value, onChange, disabled = false }: Pick<PickerProps, "value" | "onChange" | "disabled">) {
  const i18n = useI18n();
  const { t } = i18n;
  const current = normalizeStoryPoints(value);
  const cards = current !== null && !STORY_POINT_DECK.includes(current) ? [...STORY_POINT_DECK, current].sort((a, b) => a - b) : STORY_POINT_DECK;
  return (
    <CustomSelect<string>
      className="custom-select-pill story-points-select"
      ariaLabel={t("scrum.picker.label")}
      disabled={disabled}
      value={current === null ? "" : String(current)}
      onChange={(next) => onChange(next === "" ? null : normalizeStoryPoints(next))}
      renderTriggerLabel={() => <><Icon name="target" className="custom-select-icon" /><span className="custom-select-text">{current === null ? t("scrum.picker.pill") : formatStoryPoints(current, i18n)}</span></>}
      options={[
        { value: "", label: t("scrum.notEstimated") },
        ...cards.map((card) => ({ value: String(card), label: formatStoryPoints(card, i18n) })),
      ]}
    />
  );
}
