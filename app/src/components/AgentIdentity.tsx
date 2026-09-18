import { useState } from "react";
import { SiriWave } from "./SiriWave";
import "./AgentIdentity.css";

type AgentIdentityProps = {
  readonly thinking?: boolean;
  readonly size?: "tiny" | "small" | "hero";
};

/** Canvas backing size per tile (display size comes from CSS). */
const SIRI_SIZE: Record<NonNullable<AgentIdentityProps["size"]>, number> = {
  tiny: 28,
  small: 34,
  hero: 118,
};

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AgentIdentity({ thinking = false, size = "small" }: AgentIdentityProps) {
  const [reduced] = useState(prefersReducedMotion);

  return (
    <span
      className={`agent-identity agent-identity-${size} ${thinking ? "is-thinking" : "is-idle"}`}
      data-state={thinking ? "thinking" : "idle"}
      aria-hidden="true"
    >
      <span className="agent-fluid">
        <span className="agent-fluid-fallback" />
        {!reduced && (
          <SiriWave
            variant="wave"
            size={SIRI_SIZE[size]}
            renderScale={0.5}
            timeScale={thinking ? 2.4 : 0.6}
            className="agent-siri"
          />
        )}
      </span>
    </span>
  );
}
