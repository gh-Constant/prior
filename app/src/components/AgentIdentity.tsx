import "./AgentIdentity.css";

type AgentIdentityProps = {
  readonly thinking?: boolean;
  readonly size?: "tiny" | "small" | "hero";
};

/* Same geometry as Prior's "P" logo (256 grid), so the agent reads as part of the brand. */
const BOWL = "M80 48 H132 C166 48 188 70 188 104 C188 138 166 160 132 160 H80";
const STEM = "M80 48 V204";

/**
 * Prior Agent mark: the Prior "P" in cream on a dark tile, with a coral dot
 * (the agent's focus) held inside the bowl. Idle, the dot breathes; thinking,
 * a coral trace runs around the bowl. Pure SVG + CSS, crisp at every size.
 */
export function AgentIdentity({ thinking = false, size = "small" }: AgentIdentityProps) {
  return (
    <span
      className={`agent-identity agent-identity-${size} ${thinking ? "is-thinking" : "is-idle"}`}
      data-state={thinking ? "thinking" : "idle"}
      aria-hidden="true"
    >
      <svg className="agent-mark" viewBox="0 0 256 256" focusable="false">
        <path className="agent-mark-stroke" d={STEM} />
        <path className="agent-mark-stroke" d={BOWL} />
        <path className="agent-mark-trace" d={BOWL} pathLength="100" />
        <circle className="agent-mark-core" cx="134" cy="104" r="21" />
      </svg>
    </span>
  );
}
