import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import "./Modal.css";

export type ModalProps = {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabelledBy?: string;
  readonly maxWidth?: string | number;
};

export function Modal({ title, onClose, children, className = "", ariaLabelledBy, maxWidth }: ModalProps) {
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      const opener = openerRef.current;
      if (opener && document.contains(opener) && typeof opener.focus === "function") {
        opener.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="prior-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`prior-modal-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : title}
        aria-labelledby={ariaLabelledBy}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="prior-modal-header">
          <h2 id={ariaLabelledBy}>{title}</h2>
          <button
            type="button"
            className="prior-modal-close"
            aria-label="Close dialog"
            title="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type SimpleFormModalProps = {
  readonly title: string;
  readonly submitLabel: string;
  readonly name: string;
  readonly onNameChange: (value: string) => void;
  readonly namePlaceholder?: string;
  readonly nameLabel?: string;
  readonly isSubmitDisabled?: boolean;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children?: ReactNode;
};

export function SimpleFormModal({
  title,
  submitLabel,
  name,
  onNameChange,
  namePlaceholder = "Name",
  nameLabel = "Name",
  isSubmitDisabled,
  onClose,
  onSubmit,
  children,
}: SimpleFormModalProps) {
  const isValid = name.trim().length > 0;
  const canSubmit = isSubmitDisabled !== undefined ? !isSubmitDisabled && isValid : isValid;

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="prior-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <label className="prior-modal-field">
          <span>{nameLabel}</span>
          <input
            className="prior-modal-input"
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={namePlaceholder}
          />
        </label>
        {children}
        <div className="prior-modal-actions">
          <button
            type="button"
            className="prior-modal-button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="prior-modal-button-primary"
            disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
