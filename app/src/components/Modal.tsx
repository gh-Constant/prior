import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { useSheetDrag } from "../lib/useSheetDrag";
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
  const { t } = useI18n();
  // Phones show the modal as a bottom sheet: swipe the handle down to close.
  const { sheetRef, handleProps } = useSheetDrag<HTMLDivElement>(onClose);
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  // Parents pass a new onClose on every render. Reading it through a ref keeps
  // the effect below mounted for the modal's whole life: re-running it would
  // run its cleanup, which hands focus back to the opener and pulled the
  // caret out of whatever field the user was typing in on each sync.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
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
  }, []);

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
        ref={sheetRef}
        className={`prior-modal-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : title}
        aria-labelledby={ariaLabelledBy}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="prior-modal-handle" aria-hidden="true" {...handleProps} />
        <div className="prior-modal-header">
          <h2 id={ariaLabelledBy}>{title}</h2>
          <button
            type="button"
            className="prior-modal-close"
            aria-label={t("common.modal.closeDialog")}
            title={t("common.actions.close")}
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
  namePlaceholder,
  nameLabel,
  isSubmitDisabled,
  onClose,
  onSubmit,
  children,
}: SimpleFormModalProps) {
  const { t } = useI18n();
  const resolvedPlaceholder = namePlaceholder ?? t("common.modal.name");
  const resolvedLabel = nameLabel ?? t("common.modal.name");
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
          <span>{resolvedLabel}</span>
          <input
            className="prior-modal-input"
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={resolvedPlaceholder}
          />
        </label>
        {children}
        <div className="prior-modal-actions">
          <button
            type="button"
            className="prior-modal-button-secondary"
            onClick={onClose}
          >
            {t("common.actions.cancel")}
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
