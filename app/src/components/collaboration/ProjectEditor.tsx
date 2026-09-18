import { useState } from "react";
import { DEFAULT_PROJECT_ICON, PROJECT_ICON_OPTIONS } from "../WorkspaceIcon";
import { EditableIcon, IconPicker, IconUpload } from "../IconPicker";
import { EditorDialog } from "./EditorDialog";
import { CustomSelect } from "../CustomSelect";
import { useI18n } from "../../lib/i18n";
import type { EditableProject, ProjectEditorProps } from "./types";

export function ProjectEditor({ project, avatarUrl, onSave, onClose }: ProjectEditorProps) {
  const [draft, setDraft] = useState<EditableProject>(() => ({ ...project }));
  const [uploading, setUploading] = useState(false);
  const { t } = useI18n();
  const invalidDates = Boolean(draft.startDate && draft.targetDate && draft.targetDate < draft.startDate);
  function focusIconSearch() {
    document.querySelector<HTMLInputElement>(".collab-editor .icon-picker-search input")?.focus();
  }
  return <EditorDialog title={t("collab.editor.title")} onClose={onClose} invalid={!draft.name.trim() || invalidDates || uploading} onSave={() => onSave({ ...draft, name: draft.name.trim() })}>
    <div className="collab-editor-heading">
      <EditableIcon
        icon={draft.icon}
        fallback={DEFAULT_PROJECT_ICON}
        canEdit
        label={t("collab.editor.iconLabel")}
        className="collab-editor-icon"
        onOpen={focusIconSearch}
      />
      <div className="collab-editor-title">
        <strong>{draft.name.trim() || t("collab.editor.newProject")}</strong>
        <small>{t("collab.editor.iconHint")}</small>
      </div>
    </div>
    <label className="collab-field"><span>{t("collab.editor.name")}</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="collab-field"><span>{t("collab.editor.description")}</span><textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <div className="collab-field"><span>{t("collab.editor.icon")}</span>
      <IconPicker
        value={draft.icon ?? ""}
        options={PROJECT_ICON_OPTIONS}
        fallback={DEFAULT_PROJECT_ICON}
        label={t("collab.editor.icon")}
        compact
        disabled={uploading}
        onSelect={(icon) => setDraft((current) => ({ ...current, icon }))}
      />
      <IconUpload
        currentIcon={draft.icon || DEFAULT_PROJECT_ICON}
        fallback={DEFAULT_PROJECT_ICON}
        disabled={uploading}
        inputLabel={t("collab.editor.uploadImage")}
        avatarUrl={avatarUrl}
        onUseAvatar={avatarUrl ? () => setDraft((current) => ({ ...current, icon: avatarUrl })) : undefined}
        onBusyChange={setUploading}
        onUploaded={(icon) => setDraft((current) => ({ ...current, icon }))}
      />
    </div>
    <div className="collab-planning-grid">
      <label className="collab-field">
        <span>{t("collab.editor.status")}</span>
        <CustomSelect
          ariaLabel={t("collab.editor.status")}
          value={draft.status}
          onChange={(val) => setDraft({ ...draft, status: val as EditableProject["status"] })}
          options={[
            { value: "planned", label: t("collab.editor.statusPlanned") },
            { value: "active", label: t("collab.editor.statusActive") },
            { value: "paused", label: t("collab.editor.statusPaused") },
            { value: "completed", label: t("collab.editor.statusCompleted") },
          ]}
        />
      </label>
      <label className="collab-field">
        <span>{t("collab.editor.health")}</span>
        <CustomSelect
          ariaLabel={t("collab.editor.health")}
          value={draft.health ?? ""}
          onChange={(val) => setDraft({ ...draft, health: (val ? String(val) : null) as EditableProject["health"] })}
          options={[
            { value: "", label: t("collab.editor.healthNotSet") },
            { value: "On track", label: t("collab.editor.healthOnTrack"), color: "#22c55e" },
            { value: "At risk", label: t("collab.editor.healthAtRisk"), color: "#f59e0b" },
            { value: "Off track", label: t("collab.editor.healthOffTrack"), color: "#ef4444" },
          ]}
        />
      </label>
      <label className="collab-field"><span>{t("collab.editor.startDate")}</span><input type="date" value={draft.startDate ?? ""} onChange={(event) => setDraft({ ...draft, startDate: event.target.value || null })} /></label>
      <label className="collab-field"><span>{t("collab.editor.targetDate")}</span><input type="date" min={draft.startDate ?? undefined} value={draft.targetDate ?? ""} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value || null })} /></label>
    </div>
    {invalidDates && <p className="collab-error" role="alert">{t("collab.editor.dateError")}</p>}
  </EditorDialog>;
}
