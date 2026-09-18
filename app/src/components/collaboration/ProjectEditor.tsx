import { useState } from "react";
import { DEFAULT_PROJECT_ICON, PROJECT_ICON_OPTIONS } from "../WorkspaceIcon";
import { EditableIcon, IconPicker, IconUpload } from "../IconPicker";
import { EditorDialog } from "./EditorDialog";
import type { EditableProject, ProjectEditorProps } from "./types";

export function ProjectEditor({ project, avatarUrl, onSave, onClose }: ProjectEditorProps) {
  const [draft, setDraft] = useState<EditableProject>(() => ({ ...project }));
  const [uploading, setUploading] = useState(false);
  const invalidDates = Boolean(draft.startDate && draft.targetDate && draft.targetDate < draft.startDate);
  function focusIconSearch() {
    document.querySelector<HTMLInputElement>(".collab-editor .icon-picker-search input")?.focus();
  }
  return <EditorDialog title="Edit project" onClose={onClose} invalid={!draft.name.trim() || invalidDates || uploading} onSave={() => onSave({ ...draft, name: draft.name.trim() })}>
    <div className="collab-editor-heading">
      <EditableIcon
        icon={draft.icon}
        fallback={DEFAULT_PROJECT_ICON}
        canEdit
        label="Edit project icon"
        className="collab-editor-icon"
        onOpen={focusIconSearch}
      />
      <div className="collab-editor-title">
        <strong>{draft.name.trim() || "New project"}</strong>
        <small>Click the icon to pick a new one</small>
      </div>
    </div>
    <label className="collab-field"><span>Project name</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="collab-field"><span>Description</span><textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <div className="collab-field"><span>Project icon</span>
      <IconPicker
        value={draft.icon ?? ""}
        options={PROJECT_ICON_OPTIONS}
        fallback={DEFAULT_PROJECT_ICON}
        label="Project icon"
        disabled={uploading}
        onSelect={(icon) => setDraft((current) => ({ ...current, icon }))}
      />
      <IconUpload
        currentIcon={draft.icon || DEFAULT_PROJECT_ICON}
        fallback={DEFAULT_PROJECT_ICON}
        disabled={uploading}
        inputLabel="Upload project image"
        avatarUrl={avatarUrl}
        onUseAvatar={avatarUrl ? () => setDraft((current) => ({ ...current, icon: avatarUrl })) : undefined}
        onBusyChange={setUploading}
        onUploaded={(icon) => setDraft((current) => ({ ...current, icon }))}
      />
    </div>
    <div className="collab-planning-grid">
      <label className="collab-field"><span>Project status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EditableProject["status"] })}><option value="planned">Planned</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label>
      <label className="collab-field"><span>Project health</span><select value={draft.health ?? ""} onChange={(event) => setDraft({ ...draft, health: (event.target.value || null) as EditableProject["health"] })}><option value="">Not set</option><option value="On track">On track</option><option value="At risk">At risk</option><option value="Off track">Off track</option></select></label>
      <label className="collab-field"><span>Start date</span><input type="date" value={draft.startDate ?? ""} onChange={(event) => setDraft({ ...draft, startDate: event.target.value || null })} /></label>
      <label className="collab-field"><span>Target date</span><input type="date" min={draft.startDate ?? undefined} value={draft.targetDate ?? ""} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value || null })} /></label>
    </div>
    {invalidDates && <p className="collab-error" role="alert">Target date must be on or after the start date.</p>}
  </EditorDialog>;
}
