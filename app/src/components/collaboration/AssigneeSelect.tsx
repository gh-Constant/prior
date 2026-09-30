import { CustomSelect } from "../CustomSelect";
import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import { PersonAvatar } from "./PersonAvatar";
import type { Person } from "./types";
import "./Collaboration.css";

type Props = {
  readonly people: readonly Person[];
  readonly value: string | null | undefined;
  readonly onChange: (personId: string | null) => void;
  readonly currentUserId?: string | null;
  readonly disabled?: boolean;
  /** Board cards: only the avatar shows until the menu opens. */
  readonly compact?: boolean;
  readonly className?: string;
  /** Names the task in the accessible label ("Assignee of Ship v2"). */
  readonly taskTitle?: string;
};

/**
 * The one person responsible for a task (Linear's assignee). "Assign to me"
 * comes first, then the other project members, then "Unassigned".
 */
export function AssigneeSelect({ people, value, onChange, currentUserId, disabled = false, compact = false, className = "", taskTitle }: Props) {
  const { t } = useI18n();
  const assigned = people.find((person) => person.id === value) ?? null;
  const ordered = [...people].sort((left, right) => (left.id === currentUserId ? -1 : right.id === currentUserId ? 1 : left.name.localeCompare(right.name)));
  const options = [
    ...ordered.map((person) => ({
      value: person.id,
      label: <span className="assignee-option"><PersonAvatar person={person} className="collab-avatar collab-avatar-xs" showPresence={false} /><span>{person.name}{person.id === currentUserId ? ` ${t("collab.share.you")}` : ""}</span></span>,
    })),
    { value: "", label: <span className="assignee-option"><Icon name="user" className="assignee-none-icon" /><span>{t("collab.assign.none")}</span></span> },
  ];
  // A former member stays visible on tasks assigned before they left.
  if (value && !assigned) options.unshift({ value, label: <span className="assignee-option"><Icon name="user" className="assignee-none-icon" /><span>{t("collab.assign.formerMember")}</span></span> });
  const label = taskTitle ? t("collab.assign.labelFor", { title: taskTitle }) : t("collab.assign.label");
  return <CustomSelect
    ariaLabel={label}
    className={`assignee-select ${compact ? "is-compact" : "custom-select-pill"} ${assigned ? "has-value" : ""} ${className}`.trim()}
    disabled={disabled}
    value={value ?? ""}
    onChange={(next) => onChange(next ? String(next) : null)}
    options={options}
    renderTriggerLabel={() => compact
      ? (assigned ? <PersonAvatar person={assigned} className="collab-avatar collab-avatar-sm" showPresence={false} /> : <span className="assignee-empty" title={t("collab.assign.none")}><Icon name="user" /></span>)
      : <span className="assignee-option">{assigned ? <PersonAvatar person={assigned} className="collab-avatar collab-avatar-xs" showPresence={false} /> : <Icon name="user" className="assignee-none-icon" />}<span>{assigned ? assigned.name : t("collab.assign.placeholder")}</span></span>}
  />;
}
