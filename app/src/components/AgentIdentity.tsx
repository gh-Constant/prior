import { useId } from "react";
import "./AgentIdentity.css";

type AgentIdentityProps = {
  thinking?: boolean;
  size?: "tiny" | "small" | "hero";
};

export function AgentIdentity({ thinking = false, size = "small" }: AgentIdentityProps) {
  const gradientId = `prior-agent-gradient-${useId().replace(/:/g, "")}`;
  const highlightId = `${gradientId}-highlight`;

  return (
    <span
      className={`agent-identity agent-identity-${size} ${thinking ? "is-thinking" : "is-idle"}`}
      data-state={thinking ? "thinking" : "idle"}
      aria-hidden="true"
    >
      <span className="agent-symbol-aura" />
      <svg className="agent-symbol" viewBox="0 0 100 100" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="8" y1="12" x2="92" y2="88" gradientUnits="userSpaceOnUse">
            <stop className="agent-symbol-stop-one" offset="0" stopColor="#ff725d" />
            <stop className="agent-symbol-stop-two" offset=".46" stopColor="#f6ba72" />
            <stop className="agent-symbol-stop-three" offset="1" stopColor="#8ecbc9" />
          </linearGradient>
          <radialGradient id={highlightId} cx="30%" cy="18%" r="72%">
            <stop offset="0" stopColor="#fffdf8" stopOpacity=".92" />
            <stop offset=".25" stopColor="#fff6e1" stopOpacity=".34" />
            <stop offset=".72" stopColor="#fff6e1" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          className="agent-symbol-shape"
          fill={`url(#${gradientId})`}
          d="M50 3c3 0 5 2 6 6l6 28 28 6c4 1 6 3 6 7s-2 6-6 7l-28 6-6 28c-1 4-3 6-6 6s-5-2-6-6l-6-28-28-6c-4-1-6-3-6-7s2-6 6-7l28-6 6-28c1-4 3-6 6-6Z"
        />
        <path
          className="agent-symbol-highlight"
          fill={`url(#${highlightId})`}
          d="M50 3c3 0 5 2 6 6l6 28 28 6c4 1 6 3 6 7s-2 6-6 7l-28 6-6 28c-1 4-3 6-6 6s-5-2-6-6l-6-28-28-6c-4-1-6-3-6-7s2-6 6-7l28-6 6-28c1-4 3-6 6-6Z"
        />
        <path className="agent-symbol-glint" d="m34 28 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z" />
      </svg>
    </span>
  );
}
