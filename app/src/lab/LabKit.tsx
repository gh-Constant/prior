// Shared building blocks for Game Lab sections. Every demo uses LabDemo so the
// lab reads as one page; a section only decides what goes inside the stage.
import type { ReactNode } from "react";

export type LabSurface = "canvas" | "sidebar";

export type LabSectionProps = { readonly surface: LabSurface };

type LabDemoProps = {
  readonly title: string;
  readonly description?: string;
  /** Buttons, selects and toggles that drive the demo. */
  readonly controls?: ReactNode;
  readonly surface: LabSurface;
  /** Minimum stage height in px. */
  readonly height?: number;
  readonly children: ReactNode;
};

export function LabDemo({ title, description, controls, surface, height = 220, children }: LabDemoProps) {
  return (
    <article className="lab-demo">
      <header className="lab-demo-head">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      {controls && <div className="lab-demo-controls">{controls}</div>}
      <div className={`lab-stage lab-stage-${surface}`} style={{ minHeight: height }}>
        {children}
      </div>
    </article>
  );
}

export function LabButton({ children, onClick, primary }: { readonly children: ReactNode; readonly onClick: () => void; readonly primary?: boolean }) {
  return <button type="button" className={primary ? "lab-button lab-button-primary" : "lab-button"} onClick={onClick}>{children}</button>;
}

export function LabSelect<T extends string>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: readonly T[]; readonly onChange: (value: T) => void }) {
  return (
    <label className="lab-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function LabRange({ label, value, min, max, step = 1, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step?: number; readonly onChange: (value: number) => void }) {
  return (
    <label className="lab-range">
      <span>{label} <b>{value}</b></span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
