import { useState } from "react";
import { EditorDialog } from "./EditorDialog";
import { useI18n } from "../../lib/i18n";
import { DateTimePicker } from "../DateTimePicker";
import type { ProjectCycleDraft, ProjectCycleEditorProps } from "./types";

export function ProjectCycleEditor({ cycle, issues, onSave, onClose }: ProjectCycleEditorProps) {
  const [draft, setDraft] = useState<ProjectCycleDraft>(() => ({ name: cycle?.name ?? "", startsOn: cycle?.startsOn ?? "", endsOn: cycle?.endsOn ?? "", issueIds: [...new Set(cycle?.issueIds ?? [])] }));
  const [query, setQuery] = useState("");
  const { t, tp } = useI18n();
  const visible = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const assignedCount = issues.filter((issue) => draft.issueIds.includes(issue.id)).length;
  const invalidDates = Boolean(draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn);
  return <EditorDialog title={cycle ? t("collab.cycleEditor.titleEdit") : t("collab.cycleEditor.titleNew")} onClose={onClose} invalid={!draft.name.trim() || !draft.startsOn || !draft.endsOn || invalidDates} onSave={() => onSave({ ...draft, name: draft.name.trim() })}>
    <label className="collab-field"><span>{t("collab.cycleEditor.name")}</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="collab-planning-grid">
      <div className="collab-field"><span>{t("collab.cycleEditor.start")}</span><DateTimePicker required value={draft.startsOn} onChange={(value) => setDraft({ ...draft, startsOn: value })} ariaLabel={t("collab.cycleEditor.start")} /></div>
      <div className="collab-field"><span>{t("collab.cycleEditor.end")}</span><DateTimePicker required min={draft.startsOn || undefined} value={draft.endsOn} onChange={(value) => setDraft({ ...draft, endsOn: value })} ariaLabel={t("collab.cycleEditor.end")} /></div>
    </div>
    {invalidDates && <p className="collab-error" role="alert">{t("collab.cycleEditor.dateError")}</p>}
    <label className="collab-field"><span>{t("collab.cycleEditor.search")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("collab.cycleEditor.searchPlaceholder")} /></label>
    <p className="collab-muted" role="status">{tp("collab.cycleEditor.selected", assignedCount)}</p>
    <div className="collab-cycle-issues" role="group" aria-label={t("collab.cycleEditor.issuesGroup")}>{visible.map((issue) => <label key={issue.id} className="collab-cycle-issue"><input type="checkbox" checked={draft.issueIds.includes(issue.id)} onChange={(event) => setDraft({ ...draft, issueIds: event.target.checked ? [...draft.issueIds, issue.id] : draft.issueIds.filter((id) => id !== issue.id) })} /><span>{issue.identifier && <small>{issue.identifier} · </small>}{issue.title}</span></label>)}</div>
    {!visible.length && <p className="collab-muted">{query ? t("collab.cycleEditor.noMatch") : t("collab.cycleEditor.noIssues")}</p>}
  </EditorDialog>;
}
