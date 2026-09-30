import { useState } from "react";
import { EffectsProvider } from "../lib/gamification/effects";
import type { EffectsIntensity } from "../lib/gamification/types";
import { setThemePreference, useResolvedTheme } from "../lib/theme";
import { LabSelect, type LabSurface } from "./LabKit";
import { FxSection } from "./sections/FxSection";
import { NameplateSection } from "./sections/NameplateSection";
import { PetSection } from "./sections/PetSection";
import { ProgressSection } from "./sections/ProgressSection";
import { SidebarWidgetSection } from "./sections/SidebarWidgetSection";
import "./lab.css";

const SECTIONS = [
  { id: "fx", title: "Celebrations", Component: FxSection },
  { id: "identity", title: "Names, borders & inventory", Component: NameplateSection },
  { id: "pet", title: "Pet", Component: PetSection },
  { id: "progress", title: "Progress page", Component: ProgressSection },
  { id: "sidebar-widget", title: "Sidebar widget", Component: SidebarWidgetSection },
] as const;

export function Lab() {
  const [intensity, setIntensity] = useState<EffectsIntensity>("full");
  const [surface, setSurface] = useState<LabSurface>("canvas");
  // The app theme itself (shared with the app, same origin), so every default follows it.
  const theme = useResolvedTheme();

  return (
    <EffectsProvider intensity={intensity}>
      <div className="lab">
        <header className="lab-bar">
          <strong>Prior Game Lab</strong>
          <nav>{SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
          <div className="lab-bar-controls">
            <LabSelect label="Effects" value={intensity} options={["full", "subtle", "off"] as const} onChange={setIntensity} />
            <LabSelect label="Theme" value={theme} options={["light", "dark"] as const} onChange={setThemePreference} />
            <LabSelect label="Surface" value={surface} options={["canvas", "sidebar"] as const} onChange={setSurface} />
          </div>
        </header>
        <main className="lab-main">
          {SECTIONS.map(({ id, title, Component }) => (
            <section key={id} id={id} className="lab-section">
              <h2>{title}</h2>
              <Component surface={surface} />
            </section>
          ))}
        </main>
      </div>
    </EffectsProvider>
  );
}
