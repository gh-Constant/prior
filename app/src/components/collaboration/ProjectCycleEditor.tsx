import { useState } from "react";
import { EditorDialog } from "./EditorDialog";
import type { ProjectCycleDraft, ProjectCycleEditorProps } from "./types";

export function ProjectCycleEditor({ cycle, issues, onSave, onClose }: ProjectCycleEditorProps) {
  const [draft, setDraft] = useState<ProjectCycleDraft>(() => ({ name: cycle?.name ?? "", startsOn: cycle?.startsOn ?? "", endsOn: cycle?.endsOn ?? "", issueIds: [...new Set(cycle?.issueIds ?? [])] }));
  const [query, setQuery] = useState("");
  const visible = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const assignedCount = issues.filter((issue) => draft.issueIds.includes(issue.id)).length;
  const invalidDates = Boolean(draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn);
  return <EditorDialog title={cycle ? "Edit cycle" : "New cycle"} onClose={onClose} invalid={!draft.name.trim() || !draft.startsOn || !draft.endsOn || invalidDates} onSave={() => onSave({ ...draft, name: draft.name.trim() })}>
    <label className="collab-field"><span>Cycle name</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="collab-planning-grid">
      <label className="collab-field"><span>Start date</span><input type="date" required value={draft.startsOn} onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} /></label>
      <label className="collab-field"><span>End date</span><input type="date" required min={draft.startsOn || undefined} value={draft.endsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label>
    </div>
    {invalidDates && <p className="collab-error" role="alert">End date must be on or after the start date.</p>}
    <label className="collab-field"><span>Find project issues</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title or issue number" /></label>
    <p className="collab-muted" role="status">{assignedCount} project issues selected</p>
    <div className="collab-cycle-issues" role="group" aria-label="Cycle issues">{visible.map((issue) => <label key={issue.id} className="collab-cycle-issue"><input type="checkbox" checked={draft.issueIds.includes(issue.id)} onChange={(event) => setDraft({ ...draft, issueIds: event.target.checked ? [...draft.issueIds, issue.id] : draft.issueIds.filter((id) => id !== issue.id) })} /><span>{issue.identifier && <small>{issue.identifier} · </small>}{issue.title}</span></label>)}</div>
    {!visible.length && <p className="collab-muted">{query ? "No matching issues." : "No project issues available."}</p>}
  </EditorDialog>;
}
