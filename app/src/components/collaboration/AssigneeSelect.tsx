import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { useFloatingMenu } from "../../hooks/useFloatingMenu";
import { useI18n } from "../../lib/i18n";
import { MAX_ASSIGNEES, toggleAssignee } from "../../lib/assignees";
import { PersonAvatar } from "./PersonAvatar";
import type { Person } from "./types";
import "../CustomSelect.css";
import "./Collaboration.css";

/** How many avatars a stack shows before collapsing the rest into "+N". */
export const ASSIGNEE_STACK_MAX = 3;

/**
 * The assignees of a task as overlapping avatars: at most three, then "+N".
 * Ids that match no member (former members) only count in the "+N".
 */
export function AssigneeStack({ people, ids, max = ASSIGNEE_STACK_MAX, className = "" }: { people: readonly Person[]; ids: readonly string[]; max?: number; className?: string }) {
  const { t, tp } = useI18n();
  if (ids.length === 0) return null;
  const known = ids.map((id) => people.find((person) => person.id === id)).filter((person): person is Person => Boolean(person));
  const shown = known.slice(0, max);
  const extra = ids.length - shown.length;
  const names = known.map((person) => person.name).join(", ");
  return <span className={`assignee-stack ${className}`.trim()} role="group" aria-label={names ? `${t("collab.assign.assignee")}: ${names}` : tp("collab.assign.count", ids.length)}>
    {shown.map((person) => <PersonAvatar key={person.id} person={person} className="collab-avatar collab-avatar-sm assignee-stack-item" showPresence={false} />)}
    {extra > 0 && <span className="collab-avatar collab-avatar-sm assignee-stack-item assignee-stack-more" title={tp("collab.assign.more", extra)} aria-label={tp("collab.assign.more", extra)}>+{extra}</span>}
  </span>;
}

type Props = {
  readonly people: readonly Person[];
  /** The assignee ids, in order (the first is the main assignee). */
  readonly value: readonly string[];
  readonly onChange: (personIds: string[]) => void;
  readonly currentUserId?: string | null;
  readonly disabled?: boolean;
  /** Board cards: only the avatars show until the menu opens. */
  readonly compact?: boolean;
  readonly className?: string;
  /** Names the task in the accessible label ("Assignees of Ship v2"). */
  readonly taskTitle?: string;
};

/**
 * Who is responsible for a task: any number of project members (at most
 * MAX_ASSIGNEES). The menu stays open while people are toggled; the people
 * already assigned come first, then me, then the others by name.
 */
export function AssigneeSelect({ people, value, onChange, currentUserId, disabled = false, compact = false, className = "", taskTitle }: Props) {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState(false);
  // The order is fixed while the menu is open, so rows do not jump under the pointer.
  const [pinned, setPinned] = useState<readonly string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const floating = useFloatingMenu(triggerRef, {
    open,
    onClose: () => setOpen(false),
    isPill: !compact,
    offset: 4,
    minWidth: 220,
    estimatedHeight: Math.min(people.length * 36 + 54, 280),
  });

  const members = [...people].sort((left, right) => {
    const leftRank = pinned.indexOf(left.id);
    const rightRank = pinned.indexOf(right.id);
    if (leftRank !== rightRank) return (leftRank < 0 ? Infinity : leftRank) - (rightRank < 0 ? Infinity : rightRank);
    return left.id === currentUserId ? -1 : right.id === currentUserId ? 1 : left.name.localeCompare(right.name);
  });
  // A former member stays visible (and removable) on tasks assigned before they left.
  const former = value.filter((id) => !people.some((person) => person.id === id));
  const full = value.length >= MAX_ASSIGNEES;
  const first = people.find((person) => person.id === value[0]);
  const label = taskTitle ? t("collab.assign.labelFor", { title: taskTitle }) : t("collab.assign.label");

  function toggle(personId: string) {
    if (disabled) return;
    onChange(toggleAssignee(value, personId));
  }

  function openMenu() {
    if (disabled) return;
    setPinned(open ? pinned : [...value]);
    setOpen((previous) => !previous);
  }

  const menu = open ? <div ref={floating.menuRef} className={`custom-select-menu assignee-menu ${floating.placement === "top" ? "open-top" : "open-bottom"} custom-select-menu-pill`} role="listbox" aria-multiselectable="true" aria-label={label} style={floating.style}>
    {[...former, ...members.map((person) => person.id)].map((id) => {
      const person = people.find((candidate) => candidate.id === id);
      const selected = value.includes(id);
      return <button key={id} type="button" role="option" aria-selected={selected} disabled={!selected && full}
        className={`custom-select-item assignee-menu-item ${selected ? "selected" : ""}`} onClick={() => toggle(id)}>
        <span className="assignee-option">
          {person ? <PersonAvatar person={person} className="collab-avatar collab-avatar-xs" /> : <Icon name="user" className="assignee-none-icon" />}
          <span>{person ? `${person.name}${person.id === currentUserId ? ` ${t("collab.share.you")}` : ""}` : t("collab.assign.formerMember")}</span>
        </span>
        {selected && <Icon name="check" className="custom-select-check" />}
      </button>;
    })}
    {full && <p className="assignee-menu-note">{t("collab.assign.limit", { count: MAX_ASSIGNEES })}</p>}
    {value.length > 0 && <button type="button" className="custom-select-item assignee-menu-item assignee-menu-clear" onClick={() => { onChange([]); setOpen(false); }}>
      <span className="assignee-option"><Icon name="close" className="assignee-none-icon" /><span>{t("collab.assign.unassign")}</span></span>
    </button>}
  </div> : null;

  const summary = value.length === 0
    ? t("collab.assign.placeholder")
    : first ? (value.length > 1 ? `${first.name} +${value.length - 1}` : first.name) : tp("collab.assign.count", value.length);

  return <div className={`custom-select-wrap assignee-select ${compact ? "is-compact" : "custom-select-pill"} ${value.length ? "has-value" : ""} ${className}`.trim()}>
    <button ref={triggerRef} type="button" className={`custom-select-trigger assignee-trigger ${open ? "open" : ""}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={openMenu}>
      {compact
        ? (value.length ? <AssigneeStack people={people} ids={value} /> : <span className="assignee-empty" title={t("collab.assign.none")}><Icon name="user" /></span>)
        : <span className="assignee-option">{value.length ? <AssigneeStack people={people} ids={value} /> : <Icon name="user" className="assignee-none-icon" />}<span>{summary}</span></span>}
      {!compact && <Icon name="chevron-down" className={`custom-select-chevron ${open ? "rotated" : ""}`} />}
    </button>
    {floating.portalTarget && menu ? createPortal(menu, floating.portalTarget) : menu}
  </div>;
}
