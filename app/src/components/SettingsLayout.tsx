import { useId, type ReactNode } from "react";

/* ── Layout primitives: titled sections of bordered cards made of rows ── */

export function SettingsSection({ title, children, footer }: { readonly title: string; readonly children: ReactNode; readonly footer?: ReactNode }) {
  const headingId = useId();
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-section-title">{title}</h2>
      <div className="settings-group">
        {children}
        {footer && <div className="settings-group-footer">{footer}</div>}
      </div>
    </section>
  );
}

export type SettingsRowProps = {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Associates the label with a form control inside the row. */
  readonly htmlFor?: string;
  /** Control spans the full width under the text (long inputs, log viewers). */
  readonly stacked?: boolean;
  readonly children?: ReactNode;
};

export function SettingsRow({ label, description, htmlFor, stacked = false, children }: SettingsRowProps) {
  return (
    <div className={`settings-row ${stacked ? "is-stacked" : ""}`}>
      <div className="settings-row-text">
        {htmlFor ? <label className="settings-row-label" htmlFor={htmlFor}>{label}</label> : <div className="settings-row-label">{label}</div>}
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      {children !== undefined && children !== null && children !== false && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

