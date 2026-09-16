import "./AgentIdentity.css";

type AgentIdentityProps = {
  thinking?: boolean;
  size?: "tiny" | "small" | "hero";
};

export function AgentIdentity({ thinking = false, size = "small" }: AgentIdentityProps) {
  return (
    <span
      className={`agent-identity agent-identity-${size} ${thinking ? "is-thinking" : "is-idle"}`}
      data-state={thinking ? "thinking" : "idle"}
      aria-hidden="true"
    >
      <span className="agent-orb-aura" />
      <span className="agent-orb">
        <span className="agent-orb-shine" />
        <span className="agent-orb-core" />
      </span>
      <span className="agent-orb-ring agent-orb-ring-one" />
      <span className="agent-orb-ring agent-orb-ring-two" />
    </span>
  );
}
