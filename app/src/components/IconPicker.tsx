import { useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { WorkspaceIcon, imageFileToIcon } from "./WorkspaceIcon";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { Person } from "./collaboration/types";
import "./IconPicker.css";

/** Pure filter helper (unit-tested): match icon names case-insensitively. */
export function filterIconOptions(options: readonly IconName[], query: string): IconName[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((name) => name.toLowerCase().includes(needle));
}

/** Permission guard (unit-tested): overlay + click only when editable. */
export function canEditAvatar({ canEdit = false, readOnly = false }: { canEdit?: boolean; readOnly?: boolean }): boolean {
  return Boolean(canEdit) && !readOnly;
}

type IconPickerProps = {
  readonly value: string;
  readonly options: readonly IconName[];
  readonly fallback: IconName;
  readonly onSelect: (icon: string) => void;
  readonly label?: string;
  readonly disabled?: boolean;
};

export function IconPicker({ value, options, fallback, onSelect, label = "Icon", disabled = false }: IconPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = filterIconOptions(options, query);
  return (
    <div className="icon-picker" data-testid="icon-picker">
      <label className="icon-picker-search">
        <Icon name="search" aria-hidden="true" />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}s`}
          aria-label={`Search ${label.toLowerCase()}s`}
        />
        {query && (
          <button type="button" className="icon-picker-clear" aria-label="Clear icon search" onClick={() => setQuery("")}>
            <Icon name="close" />
          </button>
        )}
      </label>
      <div className="icon-picker-grid" role="radiogroup" aria-label={`${label} options`}>
        {filtered.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`icon-picker-option${value === option ? " active" : ""}`}
            aria-label={`Use ${option} icon`}
            aria-pressed={value === option}
            title={option}
            onClick={() => onSelect(option)}
          >
            <WorkspaceIcon icon={option} fallback={fallback} />
          </button>
        ))}
        {!filtered.length && <p className="icon-picker-empty">No icons match “{query.trim()}”.</p>}
      </div>
    </div>
  );
}

type IconUploadProps = {
  readonly currentIcon: string;
  readonly fallback: IconName;
  readonly onUploaded: (icon: string) => void;
  readonly avatarUrl?: string | null;
  readonly onUseAvatar?: () => void;
  readonly disabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  /** Accessible label for the file input (defaults to "Upload icon image"). */
  readonly inputLabel?: string;
};

export function IconUpload({ currentIcon, fallback, onUploaded, avatarUrl, onUseAvatar, disabled = false, onBusyChange, inputLabel = "Upload icon image" }: IconUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const dragDepth = useRef(0);

  async function handleFile(file: File | undefined) {
    if (!file || uploading || disabled) return;
    setUploading(true);
    onBusyChange?.(true);
    setError("");
    try {
      const icon = await imageFileToIcon(file);
      onUploaded(icon);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to use this image. Try a PNG or JPEG.");
    } finally {
      setUploading(false);
      onBusyChange?.(false);
    }
  }

  const isImage = currentIcon.startsWith("data:image/") || /^https:\/\//i.test(currentIcon);
  return (
    <div className="icon-upload">
      <div
        className={`icon-upload-drop${dragging ? " dragging" : ""}`}
        onDragEnter={(event) => {
          if (disabled || uploading) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (disabled || uploading) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (disabled || uploading) return;
          void handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="icon-upload-preview" aria-hidden="true">
          <WorkspaceIcon icon={currentIcon} fallback={fallback} />
        </span>
        <div className="icon-upload-copy">
          <label className="icon-upload-button" htmlFor={inputId}>
            <Icon name="download" aria-hidden="true" />
            <span>{uploading ? "Processing image…" : isImage ? "Change image" : "Upload image"}</span>
          </label>
          <small>{dragging ? "Drop the image to use it" : "Drag & drop a square PNG or JPEG, or browse"}</small>
        </div>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          hidden
          disabled={disabled || uploading}
          aria-label={inputLabel}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            void handleFile(file);
          }}
        />
      </div>
      {avatarUrl && /^https:\/\//i.test(avatarUrl) && onUseAvatar && (
        <button type="button" className="secondary-button icon-upload-avatar-btn" disabled={disabled || uploading} onClick={onUseAvatar}>
          Use my profile photo
        </button>
      )}
      {uploading && (
        <p className="icon-upload-status" role="status">
          Processing image…
        </p>
      )}
      {error && (
        <p className="icon-upload-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type EditableIconProps = {
  readonly icon?: string | null;
  readonly fallback: IconName;
  readonly canEdit?: boolean;
  readonly readOnly?: boolean;
  readonly onOpen?: () => void;
  readonly label?: string;
  readonly className?: string;
};

/** Click-on-icon wrapper: static preview when read-only, pencil-overlay button when editable. */
export function EditableIcon({ icon, fallback, canEdit = false, readOnly = false, onOpen, label = "Edit icon", className = "" }: EditableIconProps) {
  const editable = canEditAvatar({ canEdit, readOnly }) && Boolean(onOpen);
  const preview = <WorkspaceIcon icon={icon} fallback={fallback} />;
  if (!editable || !onOpen) {
    return <span className={`editable-icon ${className}`.trim()} aria-hidden={onOpen ? undefined : "true"}>{preview}</span>;
  }
  return (
    <button type="button" className={`editable-icon is-editable ${className}`.trim()} aria-label={label} title={label} onClick={onOpen}>
      {preview}
      <span className="editable-icon-overlay" aria-hidden="true">
        <Icon name="pencil" />
      </span>
    </button>
  );
}

type EditableAvatarProps = {
  readonly person: Person;
  readonly canEdit?: boolean;
  readonly readOnly?: boolean;
  readonly onOpen?: () => void;
  readonly label?: string;
  readonly className?: string;
  readonly avatarClassName?: string;
};

export function EditableAvatar({ person, canEdit = false, readOnly = false, onOpen, label = `Edit ${person.name} avatar`, className = "", avatarClassName = "collab-avatar" }: EditableAvatarProps) {
  const editable = canEditAvatar({ canEdit, readOnly }) && Boolean(onOpen);
  if (!editable || !onOpen) {
    return (
      <span className={`editable-avatar ${className}`.trim()}>
        <PersonAvatar person={person} className={avatarClassName} />
      </span>
    );
  }
  return (
    <button type="button" className={`editable-avatar is-editable ${className}`.trim()} aria-label={label} title={label} onClick={onOpen}>
      <PersonAvatar person={person} className={avatarClassName} />
      <span className="editable-avatar-overlay" aria-hidden="true">
        <Icon name="pencil" />
      </span>
    </button>
  );
}
