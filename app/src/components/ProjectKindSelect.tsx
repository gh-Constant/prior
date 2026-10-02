import { PROJECT_KINDS, type ProjectKind } from "../lib/agile";
import { useI18n } from "../lib/i18n";
import { CustomSelect } from "./CustomSelect";
import type { IconName } from "./Icon";
import "./ProjectKindSelect.css";

/** Icon of each kind, shared by the select and the project type chip. */
export const PROJECT_KIND_ICONS: Record<ProjectKind, IconName> = {
  standard: "list-todo",
  kanban: "columns",
  scrum: "refresh",
  scrumban: "layers",
};

const NAME_KEYS: Record<ProjectKind, string> = {
  standard: "scrum.kind.standard",
  kanban: "scrum.kind.kanban",
  scrum: "scrum.kind.scrum",
  scrumban: "scrum.kind.scrumban",
};
const DESCRIPTION_KEYS: Record<ProjectKind, string> = {
  standard: "scrum.kind.standardDescription",
  kanban: "scrum.kind.kanbanDescription",
  scrum: "scrum.kind.scrumDescription",
  scrumban: "scrum.kind.scrumbanDescription",
};
const BADGE_KEYS: Record<Exclude<ProjectKind, "standard">, string> = {
  kanban: "scrum.kind.badgeKanban",
  scrum: "scrum.kind.badgeScrum",
  scrumban: "scrum.kind.badgeScrumban",
};

/** Short name on a chip: Standard, Kanban, Scrum or Scrumban. */
export function projectKindBadge(kind: ProjectKind, t: (key: string) => string): string {
  return kind === "standard" ? t("common.workhub.badgeStandard") : t(BADGE_KEYS[kind]);
}

/**
 * The project type and methodology as one choice: Standard, Agile · Kanban,
 * Agile · Scrum or Agile · Scrumban, each with a one-line description (in the
 * menu, and under the field for the current choice).
 */
export function ProjectKindSelect({ value, onChange, disabled = false, ariaLabel }: {
  readonly value: ProjectKind;
  readonly onChange: (kind: ProjectKind) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="project-kind-select">
      <CustomSelect<ProjectKind>
        ariaLabel={ariaLabel ?? t("scrum.kind.label")}
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={PROJECT_KINDS.map((kind) => ({ value: kind, label: t(NAME_KEYS[kind]), description: t(DESCRIPTION_KEYS[kind]), icon: PROJECT_KIND_ICONS[kind] }))}
      />
      <p className="project-kind-hint">{t(DESCRIPTION_KEYS[value])}</p>
    </div>
  );
}
