import { useState } from "react";
import { EditorDialog } from "./EditorDialog";
import { useI18n } from "../../lib/i18n";
import { DateTimePicker } from "../DateTimePicker";
import { Icon } from "../Icon";
import type { ProjectIssue } from "./types";

export type ProjectMilestoneDraft = { name: string; description: string; targetDate: string | null; issueIds: string[] };

type Props = {
  readonly milestone?: { id: string; name: string; description?: string; targetDate?: string | null };
  readonly issues: readonly ProjectIssue[];
  /** Issues already in this milestone. */
  readonly issueIds: readonly string[];
  readonly onSave: (draft: ProjectMilestoneDraft) => Promise<void>;
  readonly onDelete?: () => Promise<void>;
  readonly onClose: () => void;
};

/** Creates or edits a project milestone and picks the issues it contains. */
export function ProjectMilestoneEditor({ milestone, issues, issueIds, onSave, onDelete, onClose }: Props) {
  const { t, tp } = useI18n();
  const [draft, setDraft] = useState<ProjectMilestoneDraft>(() => ({ name: milestone?.name ?? "", description: milestone?.description ?? "", targetDate: milestone?.targetDate ?? null, issueIds: [...issueIds] }));
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const visible = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <EditorDialog title={milestone ? t("collab.milestone.titleEdit") : t("collab.milestone.titleNew")} onClose={onClose} invalid={!draft.name.trim()} onSave={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() })}>
    <label className="collab-field"><span>{t("collab.milestone.name")}</span><input required maxLength={400} value={draft.name} placeholder={t("collab.milestone.namePlaceholder")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="collab-field"><span>{t("collab.milestone.target")}</span><DateTimePicker value={draft.targetDate ?? ""} onChange={(value) => setDraft({ ...draft, targetDate: value || null })} ariaLabel={t("collab.milestone.target")} /></div>
    <label className="collab-field"><span>{t("collab.milestone.description")}</span><textarea rows={2} maxLength={4000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <label className="collab-field"><span>{t("collab.cycleEditor.search")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("collab.cycleEditor.searchPlaceholder")} /></label>
    <p className="collab-muted" role="status">{tp("collab.milestone.selected", draft.issueIds.length)}</p>
    <div className="collab-cycle-issues" role="group" aria-label={t("collab.milestone.issuesGroup")}>{visible.map((issue) => <label key={issue.id} className="collab-cycle-issue"><input type="checkbox" checked={draft.issueIds.includes(issue.id)} onChange={(event) => setDraft({ ...draft, issueIds: event.target.checked ? [...draft.issueIds, issue.id] : draft.issueIds.filter((id) => id !== issue.id) })} /><span>{issue.identifier && <small>{issue.identifier} · </small>}{issue.title}</span></label>)}</div>
    {!visible.length && <p className="collab-muted">{query ? t("collab.cycleEditor.noMatch") : t("collab.cycleEditor.noIssues")}</p>}
    {milestone && onDelete && (confirmDelete
      ? <div className="collab-confirm"><span className="collab-muted">{t("collab.milestone.deleteHint")}</span><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>{t("collab.share.cancel")}</button><button type="button" className="danger-button" disabled={deleting} onClick={() => { setDeleting(true); void onDelete().then(onClose).finally(() => setDeleting(false)); }}>{t("collab.milestone.delete")}</button></div>
      : <button type="button" className="secondary-button collab-milestone-delete" onClick={() => setConfirmDelete(true)}><Icon name="trash" />{t("collab.milestone.delete")}</button>)}
  </EditorDialog>;
}
