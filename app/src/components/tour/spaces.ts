import type { IconName } from "../Icon";
import type { OptionalView } from "../../lib/navigation";

export type Tone = "blue" | "green" | "amber" | "violet" | "red" | "accent";

/** The optional spaces as the tour and Settings → General present them. */
export const SPACES: ReadonlyArray<{ readonly view: OptionalView; readonly icon: IconName; readonly tone: Tone }> = [
  { view: "calendar", icon: "calendar-check", tone: "red" },
  { view: "focus", icon: "target", tone: "accent" },
  { view: "eisenhower", icon: "grid", tone: "amber" },
  { view: "habits", icon: "sun", tone: "green" },
  { view: "notes", icon: "file-text", tone: "blue" },
  { view: "inbox", icon: "inbox", tone: "violet" },
  { view: "waiting", icon: "clock", tone: "violet" },
  { view: "mine", icon: "user", tone: "green" },
];
